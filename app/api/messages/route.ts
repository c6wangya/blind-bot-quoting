import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { getCurrentUserId, isAdmin, userClient } from "@/lib/auth/user";
import {
  getConversationById,
  getConversationForRetailer,
  getMessages,
  getOrCreateConversationForRetailer,
  getQuoteRef,
  sendMessage,
  type MessageItemRef,
  type QuoteTag,
} from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolve the authoritative quote tag for a send: trust the id, never the client's ref,
 *  and only tag a quote the caller can actually see (RLS via `sb`). */
async function resolveQuoteTag(quoteId: unknown, sb: SupabaseClient): Promise<QuoteTag | null> {
  const id = Number(quoteId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const ref = await getQuoteRef(id, sb);
  return ref ? { id, ref } : null;
}

const MAX_LEN = 4000;
const MAX_ITEM_REFS = 30;

/** Sanitise client-supplied item references into snapshots (clamp count + string lengths). */
function sanitizeItemRefs(raw: unknown): MessageItemRef[] | null {
  if (!Array.isArray(raw)) return null;
  const clamp = (v: unknown, n = 200): string | null => {
    const s = v == null ? "" : String(v).trim();
    return s ? s.slice(0, n) : null;
  };
  const out: MessageItemRef[] = [];
  for (const r of raw.slice(0, MAX_ITEM_REFS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = clamp(o.name, 300);
    if (!name) continue;
    const qty = Number(o.qty);
    out.push({
      name,
      sku: clamp(o.sku, 120),
      image: clamp(o.image, 1000),
      summary: clamp(o.summary, 300),
      qty: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1,
      sub: !!o.sub,
    });
  }
  return out.length ? out : null;
}

/** Fetch the thread. Admin: ?conversationId=…  Retailer: own conversation (param ignored). */
export async function GET(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (await isAdmin(uid)) {
    const conversationId = new URL(req.url).searchParams.get("conversationId");
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    const conv = await getConversationById(conversationId, admin());
    return NextResponse.json({
      conversationId,
      messages: await getMessages(conversationId, admin()),
      // The other party's last-read time — drives the sender's "Sent → Read" status.
      peerLastReadAt: conv?.retailerLastReadAt ?? null,
    });
  }
  const sb = await userClient();
  const conv = await getConversationForRetailer(uid, sb);
  return NextResponse.json({
    conversationId: conv?.id ?? null,
    messages: conv ? await getMessages(conv.id, sb) : [],
    peerLastReadAt: conv?.adminLastReadAt ?? null,
  });
}

/** Send a message. Admin: { conversationId, body }. Retailer: { body } (own conversation, lazily created). */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const b = await req.json();
    const body = String(b.body ?? "").trim();
    const itemRefs = sanitizeItemRefs(b.itemRefs);
    // A message must carry text or at least one referenced item.
    if (!body && !itemRefs) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
    if (body.length > MAX_LEN) return NextResponse.json({ error: "Message is too long" }, { status: 400 });

    if (await isAdmin(uid)) {
      if (typeof b.conversationId !== "string") {
        return NextResponse.json({ error: "conversationId required" }, { status: 400 });
      }
      const tag = await resolveQuoteTag(b.quoteId, admin());
      const message = await sendMessage(b.conversationId, uid, "admin", body, admin(), tag, itemRefs);
      return NextResponse.json({ conversationId: b.conversationId, message });
    }
    const sb = await userClient();
    const conv = await getOrCreateConversationForRetailer(uid, sb);
    const tag = await resolveQuoteTag(b.quoteId, sb);
    const message = await sendMessage(conv.id, uid, "retailer", body, sb, tag, itemRefs);
    return NextResponse.json({ conversationId: conv.id, message });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
