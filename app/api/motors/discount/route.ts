import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { setRetailerDiscount } from "@/lib/db";

/**
 * Set a retailer's standing order-level discount (% off every order subtotal). Admin only.
 * Body: { retailerId, pct }  (pct 0–100; 0 clears the discount)
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const { retailerId, pct } = await req.json();
    if (typeof retailerId !== "string" || !retailerId) {
      return NextResponse.json({ error: "retailerId required" }, { status: 400 });
    }
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      return NextResponse.json({ error: "pct must be between 0 and 100" }, { status: 400 });
    }
    await setRetailerDiscount(retailerId, pct);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
