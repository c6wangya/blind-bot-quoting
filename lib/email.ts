// Transactional email — same Resend setup as blind-bot-server/services/email.js (Resend HTTP API,
// verified `no-reply.theblindbots.com` sender domain). Every send is best-effort: if RESEND_API_KEY
// is missing or the API errors, we log and return false so email never blocks a business flow
// (e.g. a paid order must still submit even if the confirmation email fails).
import { Resend } from "resend";
import { BRAND } from "./brand";
import { buildInvoiceLines } from "./invoice";
import { recipientEmails } from "./contacts";
import { getOrder } from "./db";
import type { PaymentMethod } from "./types";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Sender must be on a Resend-verified domain — reuse the blind-bot `no-reply.theblindbots.com`.
const EMAIL_FROM = process.env.EMAIL_FROM_ORDERS || `${BRAND.name} <orders@no-reply.theblindbots.com>`;

// Internal recipient that gets a copy of every paid order.
const ADMIN_ORDER_EMAIL = process.env.ADMIN_ORDER_EMAIL || "rob.wen@theblindbots.com";

// Optional testing safety-valve: set ORDER_EMAIL_TEST_OVERRIDE to a single address to force EVERY
// customer confirmation there instead of the real recipients. Unset or empty (the default) sends
// to the real recipients from the quote (customer email + extra emails + contacts).
const CUSTOMER_EMAIL_OVERRIDE = (process.env.ORDER_EMAIL_TEST_OVERRIDE ?? "").trim();

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  stripe: "Card (Stripe)",
  paypal: "PayPal",
  bank_transfer: "Bank transfer",
};

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One row of the order summary table (rendered identically in both emails). */
type Row = { name: string; description: string; sku: string | null; qty: number; rate: number; amount: number };

/** The <table> of line items — product/accessory, qty, unit price, line total. */
function itemsTable(rows: Row[]): string {
  const body = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top;">
          <div style="font-weight:600;color:#222;">${esc(r.name)}</div>
          ${r.description ? `<div style="font-size:12px;color:#888;margin-top:2px;">${esc(r.description)}</div>` : ""}
          ${r.sku ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">SKU: ${esc(r.sku)}</div>` : ""}
        </td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;color:#555;white-space:nowrap;">${r.qty}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;color:#555;white-space:nowrap;">${money(r.rate)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;color:#222;font-weight:600;white-space:nowrap;">${money(r.amount)}</td>
      </tr>`
    )
    .join("");
  return `
    <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;">
      <thead>
        <tr style="background:#f8f9fa;">
          <th style="padding:8px;text-align:left;font-size:11px;text-transform:uppercase;color:#888;">Item</th>
          <th style="padding:8px;text-align:center;font-size:11px;text-transform:uppercase;color:#888;">Qty</th>
          <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;color:#888;">Unit</th>
          <th style="padding:8px;text-align:right;font-size:11px;text-transform:uppercase;color:#888;">Amount</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

/** Subtotal / discount / total block below the items table. */
function totalsBlock(subtotal: number, discountPct: number, total: number): string {
  const rows: string[] = [
    `<tr><td style="padding:4px 8px;color:#666;">Subtotal</td><td style="padding:4px 8px;text-align:right;color:#666;">${money(subtotal)}</td></tr>`,
  ];
  if (discountPct > 0) {
    const disc = subtotal - total;
    rows.push(
      `<tr><td style="padding:4px 8px;color:#666;">Discount (${discountPct}%)</td><td style="padding:4px 8px;text-align:right;color:#666;">-${money(disc)}</td></tr>`
    );
  }
  rows.push(
    `<tr><td style="padding:8px;font-weight:700;color:#222;border-top:2px solid #eee;">Total paid</td><td style="padding:8px;text-align:right;font-weight:700;color:#222;border-top:2px solid #eee;">${money(total)}</td></tr>`
  );
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;max-width:280px;margin-left:auto;">${rows.join("")}</table>`;
}

function shell(headerColor: string, headerTitle: string, inner: string): string {
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;border:1px solid #e0e0e0;border-radius:12px;overflow:hidden;">
    <div style="background-color:${headerColor};padding:20px;text-align:center;">
      <h2 style="color:#ffffff;margin:0;">${headerTitle}</h2>
    </div>
    <div style="padding:25px;color:#333;">${inner}</div>
    <div style="background-color:#f1f1f1;padding:15px;text-align:center;font-size:12px;color:#888;">
      Sent by ${esc(BRAND.name)}
    </div>
  </div>`;
}

/** Send one email through Resend, then log a single greppable RESULT line (Render captures
 *  stdout/stderr): outcome, kind, recipients, Resend id (success) or error, and a timestamp.
 *  Returns success. */
async function sendAndLog(
  kind: string,
  payload: { from: string; to: string[]; subject: string; html: string; replyTo?: string },
  _summary: string
): Promise<boolean> {
  const toShort = payload.to.join(", ");
  try {
    const res = await resend!.emails.send(payload);
    if (res.error) {
      console.error(
        `[order-email] ❌ RESULT: FAILED · ${kind} · to=[${toShort}] · ${new Date().toISOString()} · error=${JSON.stringify(res.error)}`
      );
      return false;
    }
    console.log(
      `[order-email] ✅ RESULT: SUCCESS · ${kind} · to=[${toShort}] · id=${res.data?.id ?? "?"} · ${new Date().toISOString()}`
    );
    return true;
  } catch (e) {
    console.error(
      `[order-email] ❌ RESULT: FAILED (threw) · ${kind} · to=[${toShort}] · ${new Date().toISOString()} · error=${(e as Error).message}`
    );
    return false;
  }
}

/**
 * On payment, notify (a) the internal ops inbox and (b) the customer — both with a clear,
 * itemized breakdown (product, qty, unit price, line total, subtotal/discount/total). Best-effort:
 * logs and returns without throwing so it can never fail the payment transition. Called from
 * markOrderPaid (the single chokepoint every payment path — Stripe / PayPal / bank transfer —
 * funnels through), so it fires exactly once per order.
 */
export async function sendOrderPaidEmails(orderId: number): Promise<void> {
  if (!resend) {
    console.warn("⚠️ RESEND_API_KEY not configured — order confirmation emails skipped.");
    return;
  }
  try {
    const order = await getOrder(orderId);
    if (!order) {
      console.error(`❌ Order ${orderId} not found — confirmation emails skipped.`);
      return;
    }
    const q = order.quote;
    const lines = buildInvoiceLines(q.items);
    const rows: Row[] = lines.map((l) => ({
      name: l.name,
      description: l.description,
      sku: l.sku,
      qty: l.qty,
      rate: l.rate,
      amount: l.amount,
    }));

    const subtotal = q.total;
    const discountPct = order.discountPct ?? 0;
    // order.amount is the net charged total (already after discount); fall back to subtotal.
    const total = order.amount ?? subtotal;
    const table = itemsTable(rows);
    const totals = totalsBlock(subtotal, discountPct, total);
    const payMethod = order.paymentMethod ? PAYMENT_LABEL[order.paymentMethod] : "Payment";
    const customerName = q.customerName?.trim() || q.retailer || "there";

    const shipLines = [
      q.shipAddress1,
      q.shipAddress2,
      [q.shipCity, q.shipState, q.shipZip].filter(Boolean).join(", "),
    ]
      .map((s) => String(s ?? "").trim())
      .filter(Boolean);
    const shipBlock = shipLines.length
      ? `<div style="margin-top:16px;"><h3 style="font-size:12px;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;padding-bottom:5px;">Ship to</h3>
         <p style="margin:8px 0;color:#555;line-height:1.5;">${shipLines.map(esc).join("<br/>")}</p></div>`
      : "";

    const metaRow = (label: string, value: string) =>
      `<p style="margin:6px 0;"><strong style="color:#555;">${label}:</strong> <span style="color:#222;">${value}</span></p>`;

    // ---- Customer confirmation ----
    const customerInner = `
      <p style="font-size:16px;">Hi ${esc(customerName)},</p>
      <p style="font-size:15px;color:#555;line-height:1.5;">Thank you — we've received your payment and your order is now confirmed and submitted to production.</p>
      <div style="background:#f8f9fa;padding:16px 20px;border-radius:8px;border-left:4px solid #28a745;margin:20px 0;">
        ${metaRow("Order", esc(order.ref))}
        ${q.projectName ? metaRow("Project", esc(q.projectName)) : ""}
        ${metaRow("Payment", esc(payMethod))}
      </div>
      <h3 style="font-size:12px;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;padding-bottom:5px;">Order summary</h3>
      ${table}
      ${totals}
      ${shipBlock}
      <p style="font-size:13px;color:#888;margin-top:28px;line-height:1.5;">We'll email you again when your order ships. Questions? Just reply to this email.</p>`;

    // Recipients = primary customer email + every additional contact (deduped). The test override,
    // when set, replaces the whole list with a single safe address so nothing reaches real customers.
    const realCustomerTo = recipientEmails(q.customerEmail, q.customerEmails, q.contacts);
    const customerTo = CUSTOMER_EMAIL_OVERRIDE ? [CUSTOMER_EMAIL_OVERRIDE] : realCustomerTo;
    if (customerTo.length) {
      const overrideNote = CUSTOMER_EMAIL_OVERRIDE
        ? ` | ⚠️TEST-OVERRIDE (real=[${realCustomerTo.join(", ")}])`
        : "";
      await sendAndLog(
        "customer-confirmation",
        {
          from: EMAIL_FROM,
          to: customerTo,
          subject: `Order confirmed — ${order.ref}`,
          html: shell("#333", "Your order is confirmed", customerInner),
        },
        `order=${order.ref} retailer=${q.retailer} items=${rows.length} total=${money(total)}${overrideNote}`
      );
    } else {
      console.warn(
        `[order-email] ${new Date().toISOString()} ⚠️ SKIPPED customer-confirmation | order=${order.ref} | reason=no customer email on quote`
      );
    }

    // ---- Internal ops notification ----
    const adminInner = `
      <p style="font-size:15px;color:#555;line-height:1.5;">A new order has been paid and submitted to production.</p>
      <div style="background:#f8f9fa;padding:16px 20px;border-radius:8px;border-left:4px solid #2563eb;margin:20px 0;">
        ${metaRow("Order", esc(order.ref))}
        ${metaRow("Quote", esc(q.ref))}
        ${metaRow("Retailer", esc(q.retailer))}
        ${q.projectName ? metaRow("Project", esc(q.projectName)) : ""}
        ${metaRow("Customer", esc(q.customerName || "—"))}
        ${q.customerEmail ? metaRow("Customer email", esc([q.customerEmail, ...(q.customerEmails ?? [])].join(", "))) : ""}
        ${q.contacts?.length ? metaRow("Also notified", esc(q.contacts.flatMap((c) => c.emails).join(", "))) : ""}
        ${q.customerPhone ? metaRow("Customer phone", esc(q.customerPhone)) : ""}
        ${metaRow("Payment", esc(payMethod))}
        ${order.paymentRef ? metaRow("Payment ref", esc(order.paymentRef)) : ""}
      </div>
      <h3 style="font-size:12px;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;padding-bottom:5px;">Items</h3>
      ${table}
      ${totals}
      ${shipBlock}`;

    await sendAndLog(
      "admin-notification",
      {
        from: EMAIL_FROM,
        to: [ADMIN_ORDER_EMAIL],
        subject: `💰 Paid order ${order.ref} — ${money(total)} (${q.retailer})`,
        html: shell("#111", "🔔 New paid order", adminInner),
        replyTo: q.customerEmail || undefined,
      },
      `order=${order.ref} quote=${q.ref} retailer=${q.retailer} customer=${q.customerName || "—"} payment=${payMethod} total=${money(total)}`
    );
  } catch (err) {
    console.error("❌ sendOrderPaidEmails failed:", (err as Error).message);
  }
}
