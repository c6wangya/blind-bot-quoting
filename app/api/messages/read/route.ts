import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { getCurrentUserId, isAdmin, userClient } from "@/lib/auth/user";
import { getConversationForRetailer, markRead } from "@/lib/db";

/** Mark a conversation read for the caller. Admin: { conversationId }. Retailer: own conversation. */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (await isAdmin(uid)) {
      const b = await req.json().catch(() => ({}));
      if (typeof b.conversationId !== "string") {
        return NextResponse.json({ error: "conversationId required" }, { status: 400 });
      }
      await markRead(b.conversationId, "admin", admin());
    } else {
      const sb = await userClient();
      const conv = await getConversationForRetailer(uid, sb);
      if (conv) await markRead(conv.id, "retailer", sb);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
