import { NextResponse } from "next/server";
import { requireOrderAccess } from "@/lib/auth/api";
import { getOrder } from "@/lib/db";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { publicOrigin } from "@/lib/site-url";

/** Start (or retry) a Stripe Checkout for an existing awaiting order. Returns { url }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrderAccess(ctx);
  if (gate instanceof NextResponse) return gate;
  const { id, sb } = gate;
  const order = await getOrder(id, sb);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "awaiting_payment") return NextResponse.json({ error: "Order is not awaiting payment" }, { status: 409 });
  if (order.paymentMethod !== "stripe") return NextResponse.json({ error: "Not a card payment order" }, { status: 400 });
  try {
    const url = await createCheckoutSession({
      order: { id: order.id, ref: order.ref, amount: order.amount ?? order.quote.total },
      origin: publicOrigin(req),
    });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
