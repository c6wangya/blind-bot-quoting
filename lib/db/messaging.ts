import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";

// THE-772 — Retailer ↔ admin support chat. One conversation per retailer; messages inherit it.
// Helpers default to admin() (system/back-office reads); retailer-facing call sites pass
// userClient() so RLS scopes them to their own conversation.

export type ChatRole = "retailer" | "admin";

export const CHAT_BUCKET = "chat-attachments";
const SIGNED_URL_TTL = 3600; // 1h — re-signed on every fetch (polling), so short is fine

export type ChatAttachment = { name: string; type: string; size: number; url: string };

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: ChatRole;
  body: string;
  createdAt: string;
  attachment?: ChatAttachment | null;
};

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
  sb: SupabaseClient = admin()
): Promise<ChatMessage> {
  const text = body.trim();
  if (!text) throw new Error("Message is empty");
  const { data, error } = await sb
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, sender_role: senderRole, body: text })
    .select(MSG_COLS)
    .single();
  if (error) throw error;
  const raw = data as unknown as RawMessage;
  await bumpConversation(conversationId, senderRole, raw.createdAt, text.slice(0, 140), sb);
  return toChatMessage(raw, null);
}

/** Insert an attachment message (optional caption) and refresh the conversation. */
export async function sendAttachmentMessage(
  conversationId: string,
  senderId: string,
  senderRole: ChatRole,
  attachment: { path: string; name: string; type: string; size: number },
  caption: string,
  sb: SupabaseClient = admin()
): Promise<ChatMessage> {
  const text = caption.trim();
  const { data, error } = await sb
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      sender_role: senderRole,
      body: text,
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
