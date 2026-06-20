import { BRAND } from "@/lib/brand";

// THE-772 — PayPal payments via REST (Orders v2): server creates an order, redirects the buyer
// to approve, then captures on return. Sandbox by default; set PAYPAL_ENV=live to go live.

const BASE = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

export const paypalConfigured = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

async function accessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal is not configured");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description ?? "PayPal auth failed");
  return data.access_token as string;
}

/** Create a PayPal order for an awaiting order; returns the buyer approval URL to redirect to. */
export async function createPaypalOrder(opts: {
  order: { id: number; ref: string; amount: number };
  origin: string;
}): Promise<string> {
  if (!(opts.order.amount > 0)) throw new Error("Order amount is invalid");
  const token = await accessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: String(opts.order.id),
          description: `Pre-order ${opts.order.ref}`,
          amount: { currency_code: "USD", value: opts.order.amount.toFixed(2) },
        },
      ],
      application_context: {
        brand_name: BRAND.name,
        user_action: "PAY_NOW",
        return_url: `${opts.origin}/api/payments/paypal/return?order_id=${opts.order.id}`,
        cancel_url: `${opts.origin}/orders/${opts.order.id}?pay=cancel`,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? "Could not start PayPal checkout");
  const approve = (data.links ?? []).find((l: { rel: string; href: string }) => l.rel === "approve")?.href;
  if (!approve) throw new Error("PayPal did not return an approval URL");
  return approve as string;
}

/** Capture an approved PayPal order. Returns its status + our order id (from custom_id). */
export async function capturePaypalOrder(
  paypalOrderId: string
): Promise<{ status: string; captureId: string | null; orderId: number | null }> {
  const token = await accessToken();
  const res = await fetch(`${BASE}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message ?? "PayPal capture failed");
  const unit = data?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    status: (capture?.status ?? data?.status ?? "") as string,
    captureId: capture?.id ?? data?.id ?? null,
    orderId: unit?.custom_id ? Number(unit.custom_id) : null,
  };
}
