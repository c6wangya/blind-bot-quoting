import Stripe from "stripe";

// THE-772 — Stripe payments via hosted Checkout (redirect). Only the secret key is needed
// server-side; no publishable key (we don't use client-side Stripe.js). Test mode in dev.

let client: Stripe | null = null;

export const stripeConfigured = () => !!process.env.STRIPE_SECRET_KEY;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Card payments are not configured");
  if (!client) client = new Stripe(key);
  return client;
}

/** Create a hosted Checkout session for an awaiting order; returns the URL to redirect to. */
export async function createCheckoutSession(opts: {
  order: { id: number; ref: string; amount: number };
  origin: string;
}): Promise<string> {
  if (!(opts.order.amount > 0)) throw new Error("Order amount is invalid");
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(opts.order.amount * 100),
          product_data: { name: `Pre-order ${opts.order.ref}` },
        },
      },
    ],
    metadata: { order_id: String(opts.order.id) },
    // Return through our verify endpoint so it works even before the webhook is set up.
    success_url: `${opts.origin}/api/payments/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.origin}/orders/${opts.order.id}?pay=cancel`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}
