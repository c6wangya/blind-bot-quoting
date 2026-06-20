import { NextResponse } from "next/server";
import { getStripe } from "@/lib/payments/stripe";
import { markOrderPaid } from "@/lib/db";
import { publicOrigin } from "@/lib/site-url";

/**
 * Stripe Checkout success return. Verifies the session and marks the order paid (a reliable
 * fallback that works even before the webhook endpoint is configured), then redirects to the
 * order page. The webhook is the backup for users who close the tab before returning.
 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId) return NextResponse.redirect(`${origin}/orders`, 303);
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const orderId = Number(session.metadata?.order_id);
    if (session.payment_status === "paid" && Number.isInteger(orderId)) {
      const ref = typeof session.payment_intent === "string" ? session.payment_intent : session.id;
      await markOrderPaid(orderId, { ref });
      return NextResponse.redirect(`${origin}/orders/${orderId}?pay=success`, 303);
    }
    return NextResponse.redirect(`${origin}/orders/${orderId || ""}?pay=pending`, 303);
  } catch {
    return NextResponse.redirect(`${origin}/orders?pay=error`, 303);
  }
}
