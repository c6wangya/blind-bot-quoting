import { NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/auth/api";
import { submitPreOrder } from "@/lib/db";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { publicOrigin } from "@/lib/site-url";
import type { PaymentMethod } from "@/lib/types";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireQuoteAccess(ctx);
  if (gate instanceof NextResponse) return gate;
  const { id, sb } = gate;
  try {
    const body = await req.json().catch(() => ({}));
    const method = body.method as PaymentMethod | undefined;

    if (method === "bank_transfer") {
      const order = await submitPreOrder(id, "bank_transfer", sb);
      return NextResponse.json({ order });
    }
    if (method === "stripe") {
      // Place the order, then hand off to Stripe Checkout (paid via the return/webhook).
      const order = await submitPreOrder(id, "stripe", sb);
      const url = await createCheckoutSession({
        order: { id: order.id, ref: order.ref, amount: order.amount ?? 0 },
        origin: publicOrigin(req),
      });
      return NextResponse.json({ redirect: url });
    }
    // PayPal hand-off is wired in a later phase (needs sandbox credentials).
    if (method === "paypal") {
      return NextResponse.json({ error: "This payment method isn't available yet" }, { status: 400 });
    }
    return NextResponse.json({ error: "Choose a payment method" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
