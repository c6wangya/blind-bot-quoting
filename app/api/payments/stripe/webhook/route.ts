import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/payments/stripe";
import { markOrderPaid, markOrderPaymentFailed } from "@/lib/db";

// Stripe signature verification needs the raw body + Node crypto — pin to the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook (backup to the success return). Verifies the signature and marks orders paid
 * on checkout.session.completed. Configure an endpoint → this URL in the Stripe dashboard and
 * put its signing secret in STRIPE_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch (err) {
    return NextResponse.json({ error: `Invalid signature: ${(err as Error).message}` }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = Number(session.metadata?.order_id);
      if (session.payment_status === "paid" && Number.isInteger(orderId)) {
        const ref = typeof session.payment_intent === "string" ? session.payment_intent : session.id;
        await markOrderPaid(orderId, { ref });
      }
    } else if (event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = Number(session.metadata?.order_id);
      if (Number.isInteger(orderId)) await markOrderPaymentFailed(orderId, "Card payment failed");
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
