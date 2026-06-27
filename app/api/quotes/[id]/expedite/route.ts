import { NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/auth/api";
import { admin } from "@/lib/supabase/admin";
import { usd } from "@/lib/format";
import {
  cancelExpedite,
  getOrCreateConversationForRetailer,
  getQuote,
  getQuoteOwnerId,
  getVariationItemModelMap,
  loadCatalog,
  requestExpedite,
  sendExpediteRequest,
} from "@/lib/db";
import { computeShipping, type MotorRate } from "@/lib/shipping";

/**
 * Expedite-pricing request lifecycle (owner/admin only, RLS via requireQuoteAccess).
 * Body: { action: "request" | "cancel" }
 *  - "request": flag the quote 'requested' and drop a special card into the retailer's support chat
 *    carrying a snapshot of the system reference fee (sum of per-line expedite rates) for the admin
 *    to price against. Does NOT touch the legacy `expedite` boolean.
 *  - "cancel": withdraw the request → 'none'.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireQuoteAccess(ctx);
  if (gate instanceof NextResponse) return gate;
  const { id, sb } = gate;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === "cancel") {
      await cancelExpedite(id, sb);
      return NextResponse.json({ ok: true });
    }

    // action === "request" (default)
    const quote = await getQuote(id, sb);
    if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

    // Reference fee = the old per-line accumulation, always-charged (rawAmount ignores waivers).
    const [catalog, itemModelMap] = await Promise.all([loadCatalog(), getVariationItemModelMap()]);
    const itemRates: Record<string, MotorRate> = {};
    for (const [itemId, modelId] of Object.entries(itemModelMap)) {
      const m = catalog.model(modelId);
      if (m) itemRates[itemId] = { shipGround: m.shipGround, shipExpedite: m.shipExpedite, shipMode: m.shipMode };
    }
    const refFee = computeShipping(quote.items, catalog, itemRates, true, quote.total, {
      ground: false,
      expedite: false,
    }).rawAmount;

    // Drop the request card into the owner's support conversation (admin client → routes to inbox
    // even when an admin triggered it acting-as the retailer). Public/demo quotes have no owner →
    // just flag the status.
    const ownerId = await getQuoteOwnerId(id);
    if (ownerId) {
      const conv = await getOrCreateConversationForRetailer(ownerId, admin());
      const units = quote.items.reduce((s, i) => s + i.qty, 0);
      const summary =
        `Requested expedited shipping for ${quote.ref} — ${quote.items.length} line item` +
        `${quote.items.length === 1 ? "" : "s"}, ${units} unit${units === 1 ? "" : "s"}, ` +
        `subtotal ${usd(quote.total)}. System reference: ${usd(refFee)}.`;
      await sendExpediteRequest(conv.id, ownerId, { id, ref: quote.ref }, summary, refFee, admin());
    }
    await requestExpedite(id, sb);
    return NextResponse.json({ ok: true, refFee });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
