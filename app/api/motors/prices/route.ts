import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { resetRetailerPrice, setBusinessPrice, setDefaultPrice, setPricesBatch, setRetailerPrice } from "@/lib/db";

/**
 * Set a motor price, or reset a retailer to default. Admin only. Body:
 *   { modelId, price }                     → set the DEFAULT price
 *   { modelId, price, tier:"business" }    → set the shared BUSINESS-tier price
 *   { modelId, retailerId, price }         → set this retailer's override
 *   { prices: [{modelId, price}] }         → batch-set DEFAULT prices ("Save all")
 *   { prices, tier:"business" }            → batch-set shared BUSINESS-tier prices
 *   { retailerId, prices: [{modelId, price}] } → batch-set this retailer's overrides
 *   { retailerId, reset: true }            → reset this retailer (all models) to default
 *   { retailerId, modelId, reset: true }   → reset one model for this retailer
 * `tier` applies only to the shared (no-retailerId) writes; it's ignored for retailer overrides.
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
      const rid = typeof retailerId === "string" && retailerId ? retailerId : null;
      await setPricesBatch(rid, clean, undefined, sharedTier);
      return NextResponse.json({ ok: true });
    }
    if (reset === true) {
      if (typeof retailerId !== "string" || !retailerId) {
        return NextResponse.json({ error: "retailerId required to reset" }, { status: 400 });
      }
      await resetRetailerPrice(retailerId, typeof modelId === "string" && modelId ? modelId : null);
      return NextResponse.json({ ok: true });
    }
    if (typeof modelId !== "string" || !modelId) {
      return NextResponse.json({ error: "modelId required" }, { status: 400 });
    }
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "price must be a non-negative number" }, { status: 400 });
    }
    if (typeof retailerId === "string" && retailerId) {
      await setRetailerPrice(modelId, retailerId, price);
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
