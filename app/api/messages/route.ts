import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { getCurrentUserId, isAdmin, userClient } from "@/lib/auth/user";
import {
  getConversationForRetailer,
  getMessages,
  getOrCreateConversationForRetailer,
  sendMessage,
} from "@/lib/db";

const MAX_LEN = 4000;

/** Fetch the thread. Admin: ?conversationId=…  Retailer: own conversation (param ignored). */
export async function GET(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (await isAdmin(uid)) {
    const conversationId = new URL(req.url).searchParams.get("conversationId");
    if (!conversationId) return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    return NextResponse.json({ conversationId, messages: await getMessages(conversationId, admin()) });
  }
  const sb = await userClient();
  const conv = await getConversationForRetailer(uid, sb);
  return NextResponse.json({
    conversationId: conv?.id ?? null,
    messages: conv ? await getMessages(conv.id, sb) : [],
  });
}

/** Send a message. Admin: { conversationId, body }. Retailer: { body } (own conversation, lazily created). */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const b = await req.json();
    const body = String(b.body ?? "").trim();
    if (!body) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
    if (body.length > MAX_LEN) return NextResponse.json({ error: "Message is too long" }, { status: 400 });

    if (await isAdmin(uid)) {
      if (typeof b.conversationId !== "string") {
        return NextResponse.json({ error: "conversationId required" }, { status: 400 });
      }
      const message = await sendMessage(b.conversationId, uid, "admin", body, admin());
      return NextResponse.json({ conversationId: b.conversationId, message });
    }
    const sb = await userClient();
    const conv = await getOrCreateConversationForRetailer(uid, sb);
    const message = await sendMessage(conv.id, uid, "retailer", body, sb);
    return NextResponse.json({ conversationId: conv.id, message });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
