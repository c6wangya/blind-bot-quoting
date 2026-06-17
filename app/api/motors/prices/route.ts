import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { resetRetailerPrice, setDefaultPrice, setRetailerPrice } from "@/lib/db";

/**
 * Set a motor price, or reset a retailer to default. Admin only. Body:
 *   { modelId, price }                     → set the DEFAULT price
 *   { modelId, retailerId, price }         → set this retailer's override
 *   { retailerId, reset: true }            → reset this retailer (all models) to default
 *   { retailerId, modelId, reset: true }   → reset one model for this retailer
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const { modelId, retailerId, price, reset } = await req.json();
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
    } else {
      await setDefaultPrice(modelId, price);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
