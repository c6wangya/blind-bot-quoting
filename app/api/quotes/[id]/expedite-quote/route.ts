import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { getCurrentUserId } from "@/lib/auth/user";
import { admin } from "@/lib/supabase/admin";
import { usd } from "@/lib/format";
import {
  getOrCreateConversationForRetailer,
  getQuoteOwnerId,
  getQuoteRef,
  sendMessage,
  setExpediteQuote,
  setExpediteQuotedFeeOnMessage,
} from "@/lib/db";

/**
 * Admin sets the flat expedited-shipping fee for a quote (from the Messages request card or the admin
 * quote page). Body: { fee: number, messageId?: string }. Bakes the fee into the quote total
 * (status → 'quoted'), marks the originating card "quoted", and replies in the retailer's chat.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const b = await req.json().catch(() => ({}));
    const fee = Number(b?.fee);

    await setExpediteQuote(id, fee, admin());
    if (typeof b?.messageId === "string" && b.messageId) {
      await setExpediteQuotedFeeOnMessage(b.messageId, Math.round(fee * 100) / 100, admin());
    }

    // Let the retailer know in their support chat (tagged to the quote).
    const ownerId = await getQuoteOwnerId(id);
    const ref = await getQuoteRef(id, admin());
    const adminUid = await getCurrentUserId();
    if (ownerId && ref && adminUid) {
      const conv = await getOrCreateConversationForRetailer(ownerId, admin());
      await sendMessage(
        conv.id,
        adminUid,
        "admin",
        `Expedited shipping for ${ref} is ${usd(fee)}. Your quote total has been updated — you can place the pre-order whenever you're ready.`,
        admin(),
        { id, ref }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
