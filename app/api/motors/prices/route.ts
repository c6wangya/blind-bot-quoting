import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { resetRetailerPrice, setBusinessPrice, setCostPrice, setCostPricesBatch, setDefaultPrice, setPricesBatch, setRetailerPrice } from "@/lib/db";

/**
 * Set a motor price, or reset a retailer to default. Admin only. Body:
 *   { modelId, price }                     → set the DEFAULT price
 *   { modelId, price, tier:"cost" }        → set the internal COST price (admin-only, per model)
 *   { modelId, price, tier:"business" }    → set the shared BUSINESS-tier price
 *   { modelId, retailerId, price }         → set this retailer's override
 *   { modelId, retailerId, price, tier:"business" } → set this retailer's PERSONAL business price
 *   { prices: [{modelId, price}] }         → batch-set DEFAULT prices ("Save all")
 *   { prices, tier:"business" }            → batch-set shared BUSINESS-tier prices
 *   { retailerId, prices: [{modelId, price}] } → batch-set this retailer's overrides
 *   { retailerId, prices, tier:"business" }    → batch-set this retailer's personal business prices
 *   { retailerId, reset: true }            → reset this retailer (both tiers, all models)
 *   { retailerId, reset: true, tier }      → reset one tier (override / personal business)
 *   { retailerId, modelId, reset: true, tier? } → reset one model (one tier, or both) for this retailer
 * `tier` selects the Business tier for shared writes, or the personal-Business row for retailer writes.
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const { modelId, retailerId, price, reset, prices, tier } = await req.json();
    const sharedTier: "default" | "business" = tier === "business" ? "business" : "default";
    if (Array.isArray(prices)) {
      const clean: { modelId: string; price: number }[] = [];
      for (const p of prices) {
        if (!p || typeof p.modelId !== "string" || !p.modelId) {
          return NextResponse.json({ error: "each price needs a modelId" }, { status: 400 });
        }
        if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price < 0) {
          return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
        }
        clean.push({ modelId: p.modelId, price: p.price });
      }
      // Cost is a global, admin-only field on the model (no retailer / tier rows).
      if (tier === "cost") {
        await setCostPricesBatch(clean);
        return NextResponse.json({ ok: true });
      }
      const rid = typeof retailerId === "string" && retailerId ? retailerId : null;
      await setPricesBatch(rid, clean, undefined, sharedTier);
      return NextResponse.json({ ok: true });
    }
    if (reset === true) {
      if (typeof retailerId !== "string" || !retailerId) {
        return NextResponse.json({ error: "retailerId required to reset" }, { status: 400 });
      }
      // No tier → clear both the override and the personal business price.
      const resetTier = tier === "business" || tier === "default" ? tier : undefined;
      await resetRetailerPrice(retailerId, typeof modelId === "string" && modelId ? modelId : null, undefined, resetTier);
      return NextResponse.json({ ok: true });
    }
    if (typeof modelId !== "string" || !modelId) {
      return NextResponse.json({ error: "modelId required" }, { status: 400 });
    }
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
    }
    if (tier === "cost") {
      await setCostPrice(modelId, price);
    } else if (typeof retailerId === "string" && retailerId) {
      await setRetailerPrice(modelId, retailerId, price, undefined, sharedTier);
    } else if (sharedTier === "business") {
      await setBusinessPrice(modelId, price);
    } else {
      await setDefaultPrice(modelId, price);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
