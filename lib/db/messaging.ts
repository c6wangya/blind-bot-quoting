import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";

// THE-772 — Retailer ↔ admin support chat. One conversation per retailer; messages inherit it.
// Helpers default to admin() (system/back-office reads); retailer-facing call sites pass
// userClient() so RLS scopes them to their own conversation.

export type ChatRole = "retailer" | "admin";
// 'chat' = ordinary message; 'expedite_request' = a customer's expedite-pricing request, rendered as
// an inline card the admin can price (migration 0026).
export type ChatKind = "chat" | "expedite_request";

export const CHAT_BUCKET = "chat-attachments";
const SIGNED_URL_TTL = 3600; // 1h — re-signed on every fetch (polling), so short is fine

export type ChatAttachment = { name: string; type: string; size: number; url: string };

// Line-item snapshot carried by an expedite-request card (messages.meta), so each product's qty +
// price shows even after the quote is later edited.
// A sub-part (variation) as PER-UNIT composition: qty is per main unit (not × order qty), unitPrice
// is its each-price. The dollar value is already folded into the parent line's unitPrice.
export type ExpediteSub = { name: string; qty: number; unitPrice: number };
export type ExpediteLine = {
  name: string;
  qty: number; // how many of this unit were ordered
  unitPrice: number; // combined per-unit price (main product + its per-unit sub-parts)
  lineTotal: number; // unitPrice × qty
  subs?: ExpediteSub[];
};
export type ExpediteMeta = { items: ExpediteLine[]; subtotal: number; units: number };

// A line item the customer attached to a support message ("I have a question about these"). A
// snapshot (name/sku/image/spec) so it still renders after the quote is later edited.
export type MessageItemRef = {
  name: string;
  sku?: string | null;
  image?: string | null;
  summary?: string | null; // short spec line (variations / colour · opacity)
  qty: number;
  // True = a sub-part (Crown / Drive …) of the preceding main item; renders nested under it.
  sub?: boolean;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: ChatRole;
  body: string;
  createdAt: string;
  attachment?: ChatAttachment | null;
  // The quote this message is "about" (sent from a quote's chat bubble). quoteRef is a
  // snapshot so the "Re: Q-…" chip still renders after the quote is deleted (quoteId → null).
  quoteId?: number | null;
  quoteRef?: string | null;
  // Expedite-request card (kind='expedite_request'): refFee = system reference snapshot at request
  // time; quotedFee = the flat fee the admin entered from this card (null = still pending).
  kind?: ChatKind;
  expediteRefFee?: number | null;
  expediteQuotedFee?: number | null;
  meta?: ExpediteMeta | null;
  // Quote/order line items the sender attached to this message (kind='chat').
  itemRefs?: MessageItemRef[] | null;
};

/** The quote a message is tagged with — passed to the send helpers from a quote's chat. */
export type QuoteTag = { id: number; ref: string };

export type Conversation = {
  id: string;
  retailerId: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastSenderRole: ChatRole | null;
  retailerLastReadAt: string;
  adminLastReadAt: string | null;
};

/** A conversation enriched for the admin inbox list (retailer identity + unread flag). */
export type ConversationListItem = Conversation & {
  retailerEmail: string;
  retailerCompany: string | null;
  unread: boolean;
};

const CONV_COLS =
  "id, retailerId:retailer_id, lastMessageAt:last_message_at, lastMessagePreview:last_message_preview, " +
  "lastSenderRole:last_sender_role, retailerLastReadAt:retailer_last_read_at, adminLastReadAt:admin_last_read_at";
const MSG_COLS =
  "id, conversationId:conversation_id, senderId:sender_id, senderRole:sender_role, body, createdAt:created_at, " +
  "quoteId:quote_id, quoteRef:quote_ref, kind, expediteRefFee:expedite_ref_fee, expediteQuotedFee:expedite_quoted_fee, meta, itemRefs:item_refs, " +
  "attachmentPath:attachment_path, attachmentName:attachment_name, attachmentType:attachment_type, attachmentSize:attachment_size";

type RawMessage = Omit<ChatMessage, "attachment"> & {
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
};

function toChatMessage(r: RawMessage, url: string | null): ChatMessage {
  const { attachmentPath, attachmentName, attachmentType, attachmentSize, ...rest } = r;
  return {
    ...rest,
    attachment:
      attachmentPath && url
        ? { name: attachmentName ?? "file", type: attachmentType ?? "", size: attachmentSize ?? 0, url }
        : null,
  };
}

/** Sign one attachment path (service_role) — callers gate conversation access first. */
async function signAttachment(path: string): Promise<string | null> {
  const { data } = await admin().storage.from(CHAT_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

/** Is the conversation's latest message an unread one for `role`? */
function isUnreadFor(conv: Conversation, role: ChatRole): boolean {
  if (!conv.lastSenderRole || conv.lastSenderRole === role) return false; // nothing, or my own last message
  const readAt = role === "admin" ? conv.adminLastReadAt : conv.retailerLastReadAt;
  return !readAt || new Date(conv.lastMessageAt) > new Date(readAt);
}

export async function getConversationForRetailer(
  retailerId: string,
  sb: SupabaseClient = admin()
): Promise<Conversation | null> {
  const { data } = await sb.from("conversations").select(CONV_COLS).eq("retailer_id", retailerId).maybeSingle();
  return (data as unknown as Conversation) ?? null;
}

export async function getOrCreateConversationForRetailer(
  retailerId: string,
  sb: SupabaseClient = admin()
): Promise<Conversation> {
  const existing = await getConversationForRetailer(retailerId, sb);
  if (existing) return existing;
  const { data, error } = await sb
    .from("conversations")
    .insert({ retailer_id: retailerId })
    .select(CONV_COLS)
    .single();
  if (error) {
    // Lost a create race (unique retailer_id) — re-read the winner.
    const again = await getConversationForRetailer(retailerId, sb);
    if (again) return again;
    throw error;
  }
  return data as unknown as Conversation;
}

export async function getConversationById(id: string, sb: SupabaseClient = admin()): Promise<Conversation | null> {
  const { data } = await sb.from("conversations").select(CONV_COLS).eq("id", id).maybeSingle();
  return (data as unknown as Conversation) ?? null;
}

/** All conversations for the admin inbox, newest activity first, with retailer identity + unread. */
export async function listConversations(sb: SupabaseClient = admin()): Promise<ConversationListItem[]> {
  const { data } = await sb.from("conversations").select(CONV_COLS).order("last_message_at", { ascending: false });
  const convs = (data as unknown as Conversation[]) ?? [];
  if (convs.length === 0) return [];
  const ids = convs.map((c) => c.retailerId);
  const { data: profs } = await sb.from("profiles").select("id, email, company").in("id", ids);
  const byId = new Map((profs ?? []).map((p) => [p.id as string, p as { email: string; company: string | null }]));
  return convs.map((c) => ({
    ...c,
    retailerEmail: byId.get(c.retailerId)?.email ?? "Unknown",
    retailerCompany: byId.get(c.retailerId)?.company ?? null,
    unread: isUnreadFor(c, "admin"),
  }));
}

export async function getMessages(conversationId: string, sb: SupabaseClient = admin()): Promise<ChatMessage[]> {
  const { data } = await sb
    .from("messages")
    .select(MSG_COLS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  const rows = (data as unknown as RawMessage[]) ?? [];
  // Batch-sign any attachment paths (service_role); access already gated by the caller.
  const paths = rows.map((r) => r.attachmentPath).filter((p): p is string => !!p);
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await admin().storage.from(CHAT_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
    (signed ?? []).forEach((s) => {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
    });
  }
  return rows.map((r) => toChatMessage(r, r.attachmentPath ? urlByPath.get(r.attachmentPath) ?? null : null));
}

/** Insert a message and refresh the conversation's cached preview + the sender's own read mark. */
export async function sendMessage(
  conversationId: string,
  senderId: string,
  senderRole: ChatRole,
  body: string,
  sb: SupabaseClient = admin(),
  quote: QuoteTag | null = null,
  itemRefs: MessageItemRef[] | null = null
): Promise<ChatMessage> {
  const text = body.trim();
  const items = itemRefs?.length ? itemRefs : null;
  if (!text && !items) throw new Error("Message is empty");
  const { data, error } = await sb
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      sender_role: senderRole,
      body: text,
      quote_id: quote?.id ?? null,
      quote_ref: quote?.ref ?? null,
      item_refs: items,
    })
    .select(MSG_COLS)
    .single();
  if (error) throw error;
  const raw = data as unknown as RawMessage;
  // Preview falls back to an item summary when the message is items-only (no caption).
  const preview = (text || `📦 ${items!.map((i) => i.name).join(", ")}`).slice(0, 140);
  await bumpConversation(conversationId, senderRole, raw.createdAt, preview, sb);
  return toChatMessage(raw, null);
}

/**
 * Insert a customer's expedite-pricing request as a special card message (kind='expedite_request')
 * carrying the system reference fee, then refresh the conversation. Sent into the retailer's own
 * support conversation (sender_role='retailer') regardless of who triggered it (admin acting-as
 * included), so it routes to the admin inbox exactly like a customer message.
 */
export async function sendExpediteRequest(
  conversationId: string,
  retailerId: string,
  quote: QuoteTag,
  body: string,
  refFee: number,
  meta: ExpediteMeta,
  sb: SupabaseClient = admin()
): Promise<ChatMessage> {
  const { data, error } = await sb
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: retailerId,
      sender_role: "retailer",
      body: body.trim(),
      kind: "expedite_request",
      quote_id: quote.id,
      quote_ref: quote.ref,
      expedite_ref_fee: refFee,
      meta,
    })
    .select(MSG_COLS)
    .single();
  if (error) throw error;
  const raw = data as unknown as RawMessage;
  await bumpConversation(conversationId, "retailer", raw.createdAt, `⚡ Expedite request · ${quote.ref}`, sb);
  return toChatMessage(raw, null);
}

/** Record the flat fee an admin entered on an expedite-request card (so it shows "Quoted"). */
export async function setExpediteQuotedFeeOnMessage(
  messageId: string,
  fee: number,
  sb: SupabaseClient = admin()
): Promise<void> {
  await sb.from("messages").update({ expedite_quoted_fee: fee }).eq("id", messageId);
}

/** Insert an attachment message (optional caption) and refresh the conversation. */
export async function sendAttachmentMessage(
  conversationId: string,
  senderId: string,
  senderRole: ChatRole,
  attachment: { path: string; name: string; type: string; size: number },
  caption: string,
  sb: SupabaseClient = admin(),
  quote: QuoteTag | null = null
): Promise<ChatMessage> {
  const text = caption.trim();
  const { data, error } = await sb
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      sender_role: senderRole,
      body: text,
      quote_id: quote?.id ?? null,
      quote_ref: quote?.ref ?? null,
      attachment_path: attachment.path,
      attachment_name: attachment.name,
      attachment_type: attachment.type,
      attachment_size: attachment.size,
    })
    .select(MSG_COLS)
    .single();
  if (error) throw error;
  const raw = data as unknown as RawMessage;
  const preview = (text || `📎 ${attachment.name}`).slice(0, 140);
  await bumpConversation(conversationId, senderRole, raw.createdAt, preview, sb);
  return toChatMessage(raw, await signAttachment(attachment.path));
}

/** Update the conversation's cached preview + the sender's own read mark after a new message. */
async function bumpConversation(
  conversationId: string,
  senderRole: ChatRole,
  at: string,
  preview: string,
  sb: SupabaseClient
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_message_at: at,
    last_message_preview: preview,
    last_sender_role: senderRole,
  };
  // The sender has obviously seen everything up to their own message.
  if (senderRole === "admin") patch.admin_last_read_at = at;
  else patch.retailer_last_read_at = at;
  await sb.from("conversations").update(patch).eq("id", conversationId);
}

export async function markRead(conversationId: string, role: ChatRole, sb: SupabaseClient = admin()): Promise<void> {
  const col = role === "admin" ? "admin_last_read_at" : "retailer_last_read_at";
  await sb.from("conversations").update({ [col]: new Date().toISOString() }).eq("id", conversationId);
}

/**
 * Unread badge count for the sidebar.
 *  - retailer: number of admin messages in their conversation since they last read.
 *  - admin: number of conversations whose latest message is an unanswered retailer message.
 */
export async function getUnreadCount(
  userId: string,
  isAdminUser: boolean,
  sb: SupabaseClient = admin()
): Promise<number> {
  if (isAdminUser) {
    const { data } = await sb
      .from("conversations")
      .select("last_message_at, admin_last_read_at, last_sender_role")
      .eq("last_sender_role", "retailer");
    return ((data ?? []) as { last_message_at: string; admin_last_read_at: string | null }[]).filter(
      (c) => !c.admin_last_read_at || new Date(c.last_message_at) > new Date(c.admin_last_read_at)
    ).length;
  }
  const conv = await getConversationForRetailer(userId, sb);
  if (!conv) return 0;
  const { count } = await sb
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conv.id)
    .eq("sender_role", "admin")
    .gt("created_at", conv.retailerLastReadAt);
  return count ?? 0;
}
