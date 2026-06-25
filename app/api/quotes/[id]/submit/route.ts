import { NextResponse } from "next/server";
import { requireQuoteAccessOrToken } from "@/lib/auth/api";
import { getActingContext } from "@/lib/auth/acting-as";
import { getProfile, submitPreOrder } from "@/lib/db";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { createPaypalOrder } from "@/lib/payments/paypal";
import { publicOrigin } from "@/lib/site-url";
import type { PaymentMethod } from "@/lib/types";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireQuoteAccessOrToken(req, ctx);
  if (gate instanceof NextResponse) return gate;
  const { id, sb } = gate;
  // If an admin is placing this on behalf of a retailer (代下单), audit it in the order timeline.
  const acting = await getActingContext();
  let actingAdmin: { email: string } | undefined;
  if (acting.actingAsId && acting.realUid) {
    const p = await getProfile(acting.realUid);
    actingAdmin = { email: p?.email ?? "admin" };
  }
  try {
    const body = await req.json().catch(() => ({}));
    const method = body.method as PaymentMethod | undefined;

    if (method === "bank_transfer") {
      const order = await submitPreOrder(id, "bank_transfer", sb, actingAdmin);
      return NextResponse.json({ order });
    }
    if (method === "stripe") {
      // Place the order, then hand off to Stripe Checkout (paid via the return/webhook).
      const order = await submitPreOrder(id, "stripe", sb, actingAdmin);
      const url = await createCheckoutSession({
        order: { id: order.id, ref: order.ref, amount: order.amount ?? 0 },
        origin: publicOrigin(req),
      });
      return NextResponse.json({ redirect: url });
    }
    if (method === "paypal") {
      const order = await submitPreOrder(id, "paypal", sb, actingAdmin);
      const url = await createPaypalOrder({
        order: { id: order.id, ref: order.ref, amount: order.amount ?? 0 },
        origin: publicOrigin(req),
      });
      return NextResponse.json({ redirect: url });
    }
    return NextResponse.json({ error: "Choose a payment method" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
