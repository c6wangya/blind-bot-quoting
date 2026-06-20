import { NextResponse } from "next/server";
import { capturePaypalOrder } from "@/lib/payments/paypal";
import { getOrder, markOrderPaid } from "@/lib/db";
import { publicOrigin } from "@/lib/site-url";

export const runtime = "nodejs";

/**
 * PayPal approval return. Captures the approved order and marks our order paid. PayPal appends
 * ?token=<paypal order id>&PayerID=… to the return_url; we also pass our own order_id.
 */
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const paypalOrderId = url.searchParams.get("token");
  const ourOrderId = Number(url.searchParams.get("order_id"));

  // Already paid (e.g. the buyer refreshed the return page) → don't capture twice.
  if (Number.isInteger(ourOrderId)) {
    const existing = await getOrder(ourOrderId);
    if (existing?.paymentStatus === "paid") return NextResponse.redirect(`${origin}/orders/${ourOrderId}?pay=success`, 303);
  }
  if (!paypalOrderId) return NextResponse.redirect(`${origin}/orders/${ourOrderId || ""}?pay=cancel`, 303);

  try {
    const cap = await capturePaypalOrder(paypalOrderId);
    const orderId = cap.orderId ?? (Number.isInteger(ourOrderId) ? ourOrderId : null);
    if (cap.status === "COMPLETED" && orderId) {
      await markOrderPaid(orderId, { ref: cap.captureId });
      return NextResponse.redirect(`${origin}/orders/${orderId}?pay=success`, 303);
    }
    return NextResponse.redirect(`${origin}/orders/${orderId ?? ""}?pay=pending`, 303);
  } catch {
    return NextResponse.redirect(`${origin}/orders/${ourOrderId || ""}?pay=error`, 303);
  }
}
