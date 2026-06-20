import { NextResponse } from "next/server";
import { requireOrderAccess } from "@/lib/auth/api";
import { getOrder } from "@/lib/db";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { createPaypalOrder } from "@/lib/payments/paypal";
import { publicOrigin } from "@/lib/site-url";

/** Start (or retry) a gateway payment (Stripe or PayPal) for an existing awaiting order. Returns { url }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrderAccess(ctx);
  if (gate instanceof NextResponse) return gate;
  const { id, sb } = gate;
  const order = await getOrder(id, sb);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "awaiting_payment") return NextResponse.json({ error: "Order is not awaiting payment" }, { status: 409 });
  const amount = order.amount ?? order.quote.total;
  try {
    if (order.paymentMethod === "stripe") {
      const url = await createCheckoutSession({ order: { id: order.id, ref: order.ref, amount }, origin: publicOrigin(req) });
      return NextResponse.json({ url });
    }
    if (order.paymentMethod === "paypal") {
      const url = await createPaypalOrder({ order: { id: order.id, ref: order.ref, amount }, origin: publicOrigin(req) });
      return NextResponse.json({ url });
    }
    return NextResponse.json({ error: "This order isn't a card/PayPal payment" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
