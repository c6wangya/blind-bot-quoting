import { Fragment } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InvoiceAutoPay, InvoicePayPicker, PrintInvoiceButton } from "@/components/InvoiceActions";
import { SubmitPreOrderButton } from "@/components/QuoteActions";
import { Badge, Button } from "@/components/ui";
import { canAccessOwned, userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import { BRAND } from "@/lib/brand";
import { isAccessoryConfig } from "@/lib/types";
import {
  getAccessoryDefaultPriceBySku,
  getVariationItemDetails,
  getVariationItemTierList,
  isBusinessPricingEnabled,
  getBankInfo,
  getOrAssignInvoiceRef,
  getOrder,
  getOrderRefByQuote,
  getQuote,
  getQuoteOwnerId,
  getRetailerDiscount,
} from "@/lib/db";
import { signInvoiceToken, verifyInvoiceToken } from "@/lib/invoice-token";
import { fmtDate, usd } from "@/lib/format";
import {
  buildInvoiceLines,
  INVOICE_CONDITIONS,
  INVOICE_NOTES,
  INVOICE_TERMS_LABEL,
  getSeller,
} from "@/lib/invoice";

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Plain 2-decimal number (no currency symbol) — line rows show bare amounts like the reference. */
const num2 = (n: number) => n.toFixed(2);

/** Pull the issue date out of an INV{YYYYMMDD}{NN} number so it matches the number on the page. */
function issueDateFromRef(ref: string): string | null {
  const m = ref.match(/^INV(\d{4})(\d{2})(\d{2})\d+$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T00:00:00` : null;
}

/**
 * Printable customer invoice for a quote. Proforma while the quote is a draft (a "Confirm & pay"
 * button runs the real submit→checkout flow); a final invoice with live Paid status once the quote
 * has converted into an order. Standalone (no portal chrome) so it prints clean — the browser's
 * print dialog is the PDF export.
 */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; pay?: string; openpay?: string }>;
}) {
  const { id } = await params;
  const quoteId = Number(id);
  if (!Number.isInteger(quoteId)) notFound();

  // Public pay-by-link: a valid HMAC token (typically embedded in the shared/printed PDF) grants
  // anonymous view + pay with a service_role read — no portal login. Otherwise the page mirrors
  // /quotes: an admin acting on behalf of a retailer (代下单) reads as that retailer (service_role),
  // a plain retailer reads their own (RLS). Using the same identity as the list keeps the Invoice
  // link and this page in agreement (else acting-as 404s here).
  const { t, pay, openpay } = await searchParams;
  const publicMode = verifyInvoiceToken(quoteId, t);
  // Payment Options deep link (?pay=…) — auto-start that method on load (see InvoiceAutoPay).
  const payMethod = pay === "paypal" || pay === "stripe" || pay === "bank_transfer" ? pay : null;

  let sb: SupabaseClient;
  if (publicMode) {
    sb = admin();
  } else {
    const ctx = await getActingContext();
    if (!ctx.realUid) redirect(`/login?next=${encodeURIComponent(`/invoices/${id}`)}`);
    sb = ctx.actingAsId ? admin() : await userClient();
    if (!(await canAccessOwned(ctx.realUid, await getQuoteOwnerId(quoteId)))) notFound();
  }

  const quote = await getQuote(quoteId, sb);
  if (!quote) notFound();

  // Eligibility: a real owned quote (public demo samples have no owner, and the discount/address
  // lookups below need one). The old "complete Bill-To details" requirement was removed — any
  // owned quote can be invoiced now, even with missing customer/ship-to fields. Access was already
  // gated above (canAccessOwned).
  if (!quote.ownerId) notFound();
  const ownerId = quote.ownerId as string;

  const invoiceRef = await getOrAssignInvoiceRef(quoteId);
  // The quote stays "draft" until payment lands, so a placed-but-unpaid pre-order (awaiting_payment)
  // is found here too — that's what flips the invoice from "Confirm & pay" to the pay/bank-details
  // view (and shows the awaiting status), rather than gating on quote.status === "converted".
  const orderRef = await getOrderRefByQuote(quoteId, sb);
  const order = orderRef ? await getOrder(orderRef.id, sb) : undefined;
  const bank = await getBankInfo();
  const seller = await getSeller();

  // A business-authorized retailer sees the Business tier as their struck-through "List" (both the
  // motor base and each model-backed sub-part), matching the tier their Rate was priced from.
  const business = await isBusinessPricingEnabled(ownerId);
  const [defaultPriceBySku, variationDetails, itemTierList] = await Promise.all([
    getAccessoryDefaultPriceBySku(admin(), business),
    getVariationItemDetails(),
    business ? getVariationItemTierList(admin(), true) : Promise.resolve<Record<string, number>>({}),
  ]);
  // Overlay the Business-tier list onto the sub-part details (keep the live thumbnail).
  for (const id of Object.keys(itemTierList)) {
    if (variationDetails[id]) variationDetails[id] = { ...variationDetails[id], price: itemTierList[id] };
  }
  const lines = buildInvoiceLines(quote.items, defaultPriceBySku, variationDetails);
  // Show the struck-through "List" column only if at least one line actually has a Default-tier price.
  const hasListPrice = lines.some((l) => l.listRate != null);
  const discountPct = await getRetailerDiscount(ownerId);
  const subtotal = round2(quote.total);
  const discountAmt = round2((subtotal * discountPct) / 100);
  const total = order?.amount ?? round2(subtotal - discountAmt);
  const paid = order?.paymentStatus === "paid";
  const balanceDue = paid ? 0 : total;

  // Absolute URL to this online invoice — the Payment Options links must be absolute so they stay
  // clickable from a downloaded/printed PDF (a relative href is meaningless once the PDF is off-site).
  // It carries the share token so opening it from the PDF lands in public (no-login) pay mode.
  const shareToken = signInvoiceToken(quoteId);
  const tokenQuery = shareToken ? `?t=${shareToken}` : "";
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const invoiceUrl = `${host ? `${proto}://${host}` : ""}/invoices/${quote.id}${tokenQuery}`;

  const issuedAt = issueDateFromRef(invoiceRef) ?? order?.createdAt ?? quote.createdAt;
  // Top header = the product brand(s) on this invoice (e.g. A-OK, B-OK), deduped — one line each
  // when the invoice spans multiple brands. Only accessory lines carry a brand; fall back to our
  // own brand when none are present.
  const productBrands = Array.from(
    new Set(
      quote.items
        .map((it) => (isAccessoryConfig(it.config) ? it.config.brand?.trim() : null))
        .filter((b): b is string => Boolean(b)),
    ),
  );
  const brandLines = productBrands.length ? productBrands : [BRAND.name];
  const billToName = quote.customerName ?? quote.retailer;
  const billToLines = [
    quote.shipAddress1,
    quote.shipAddress2,
    [quote.shipCity, quote.shipState, quote.shipZip].filter(Boolean).join(", ") || null,
    quote.customerEmail,
    quote.customerPhone,
  ].filter(Boolean) as string[];

  return (
    <div className="min-h-screen bg-[#f4f2ec] py-6 print:bg-white print:py-0">
      <InvoiceAutoPay
        method={payMethod}
        orderId={order?.status === "awaiting_payment" ? order.id : null}
        quoteId={quote.id}
        canSubmit={!paid && !order}
        token={shareToken}
      />
      {/* Action bar — hidden when printing */}
      <div className="mx-auto mb-5 flex max-w-3xl items-center justify-between gap-3 px-4 print:hidden">
        {publicMode ? (
          <span />
        ) : (
          <Link href={`/quotes/${quote.id}`} className="text-sm font-medium text-muted hover:text-ink">
            ← Back to {quote.ref}
          </Link>
        )}
        <div className="flex items-center gap-2">
          <PrintInvoiceButton fileName={`${seller.name} ${invoiceRef}`} />
          {paid ? (
            <Badge tone="green">Paid {order?.paidAt ? `· ${fmtDate(order.paidAt)}` : ""}</Badge>
          ) : order ? (
            publicMode ? (
              <InvoicePayPicker
                orderId={order.id}
                token={shareToken}
                currentMethod={order.paymentMethod}
                amountLabel={usd(total)}
                autoOpen={openpay === "1"}
              />
            ) : (
              <Link href={`/orders/${order.id}`}>
                <Button variant="primary" className="py-2.5">
                  Pay this invoice →
                </Button>
              </Link>
            )
          ) : (
            <SubmitPreOrderButton quoteId={quote.id} total={usd(total)} token={publicMode ? shareToken : undefined} />
          )}
        </div>
      </div>

      {/* Invoice sheet */}
      <div className="mx-auto max-w-3xl bg-white px-10 py-10 text-[13px] text-ink shadow-sm ring-1 ring-line [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:max-w-none print:shadow-none print:ring-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div>
            {/* Our brand logo. */}
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brass to-[#8a6a39] text-lg font-bold text-white">
              {BRAND.monogram}
            </div>
            <div className="mt-3">
              {brandLines.map((b, i) => (
                <div key={i} className="text-base font-bold text-ink">
                  {b}
                </div>
              ))}
            </div>
            {/* Seller disclosure — our brand is the selling/billing entity. */}
            <div className="mt-2 text-[12px] text-muted">Sold By {BRAND.name} portal</div>
            {seller.addressLines.map((l, i) => (
              <div key={i} className="text-[12px] text-muted">
                {l}
              </div>
            ))}
            <div className="mt-1 text-[12px] text-muted">Tax ID: {seller.taxId}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-light uppercase tracking-wide text-ink">Invoice</div>
            <div className="mt-1 text-[13px] font-semibold text-ink"># {invoiceRef}</div>
            <div className="mt-4 inline-block rounded-lg bg-[#f4f2ec] px-4 py-2 text-right">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Balance Due</div>
              <div className="text-xl font-bold tabular-nums text-ink">{usd(balanceDue)}</div>
            </div>
          </div>
        </div>

        {/* Bill-to + meta */}
        <div className="mt-8 flex justify-between gap-8">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Bill To</div>
            <div className="mt-1 text-[13px] font-semibold text-ink">{billToName}</div>
            {billToLines.map((l, i) => (
              <div key={i} className="text-[12px] text-muted">
                {l}
              </div>
            ))}
          </div>
          <table className="text-[12.5px]">
            <tbody>
              <tr>
                <td className="py-0.5 pr-6 text-muted">Invoice Date</td>
                <td className="py-0.5 text-right text-ink">{fmtDate(issuedAt)}</td>
              </tr>
              <tr>
                <td className="py-0.5 pr-6 text-muted">Terms</td>
                <td className="py-0.5 text-right text-ink">{INVOICE_TERMS_LABEL}</td>
              </tr>
              <tr>
                <td className="py-0.5 pr-6 text-muted">Due Date</td>
                <td className="py-0.5 text-right text-ink">{fmtDate(issuedAt)}</td>
              </tr>
              {quote.po && (
                <tr>
                  <td className="py-0.5 pr-6 text-muted">PO #</td>
                  <td className="py-0.5 text-right text-ink">{quote.po}</td>
                </tr>
              )}
              <tr>
                <td className="py-0.5 pr-6 text-muted">Quote Ref</td>
                <td className="py-0.5 text-right text-ink">{quote.ref}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Line items — reference-invoice table; the per-line breakdown rows are styled like the
            quote receipt (aligned "label … count × price") instead of a cramped nested list. */}
        <table className="mt-8 w-full border-collapse text-[13px]">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-20" />
            {hasListPrice && <col className="w-24" />}
            <col className="w-24" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="bg-[#3a3a3a] text-left font-normal text-white">
              <th className="px-4 py-2.5 text-center font-normal">#</th>
              <th className="px-4 py-2.5 font-normal">Item &amp; Description</th>
              <th className="px-4 py-2.5 text-right font-normal">Qty</th>
              {hasListPrice && <th className="px-4 py-2.5 text-right font-normal">List</th>}
              <th className="px-4 py-2.5 text-right font-normal">Rate</th>
              <th className="px-4 py-2.5 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              // Accessory lines expand to one row per component (motor + each add-on part), each with
              // its OWN Qty/List/Rate/Amount. Everything else is a single row from the line itself.
              const rows =
                l.breakdown ??
                [{ label: l.name, unit: l.rate, qty: l.qty, amount: l.amount, listUnit: l.listRate, image: l.image }];
              return (
                <Fragment key={l.n}>
                  {rows.map((r, i) => {
                    const isHead = i === 0;
                    const isLast = i === rows.length - 1;
                    const pad = `px-4 ${isHead ? "pt-4" : "pt-1"} ${isLast ? "pb-4" : "pb-0"}`;
                    return (
                      <tr key={i} className={`align-top ${isLast ? "border-b border-[#e6e3db]" : ""}`}>
                        <td className={`${pad} text-center text-ink`}>{isHead ? l.n : ""}</td>
                        <td className={pad}>
                          {isHead ? (
                            <div className="flex items-start gap-3">
                              {l.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={l.image}
                                  alt=""
                                  className="size-12 shrink-0 rounded-md bg-[#0e0e10] object-contain p-1 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                                />
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-ink">
                                  {l.name}
                                  {l.sku && <span className="text-[#8a8a8a]"> · {l.sku}</span>}
                                </div>
                                {l.description && (
                                  <div className="mt-0.5 text-[12px] text-[#8a8a8a]">{l.description}</div>
                                )}
                              </div>
                            </div>
                          ) : (
                            // Add-on part: indented, with its own thumbnail (empty spacer keeps
                            // labels aligned when a part has no photo).
                            <div className="flex items-center gap-3 pl-6">
                              {r.image ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={r.image}
                                  alt=""
                                  className="size-9 shrink-0 rounded-md bg-[#0e0e10] object-contain p-1 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
                                />
                              ) : (
                                <div className="size-9 shrink-0" />
                              )}
                              <span className="min-w-0 text-[12px] text-[#6a6a6a]">{r.label}</span>
                            </div>
                          )}
                        </td>
                        <td className={`${pad} text-right tabular-nums ${isHead ? "text-ink" : "text-[#6a6a6a]"}`}>
                          {r.qty}
                          {isHead && <div className="text-[12px] text-[#8a8a8a]">Each</div>}
                        </td>
                        {hasListPrice && (
                          <td className={`${pad} text-right tabular-nums text-[#8a8a8a]`}>
                            {r.listUnit != null ? <span className="line-through">{num2(r.listUnit)}</span> : ""}
                          </td>
                        )}
                        <td className={`${pad} text-right tabular-nums ${isHead ? "text-ink" : "text-[#6a6a6a]"}`}>
                          {num2(r.unit)}
                        </td>
                        <td className={`${pad} text-right tabular-nums ${isHead ? "text-ink" : "text-[#6a6a6a]"}`}>
                          {num2(r.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <table className="w-[340px] text-[13px]">
            <tbody>
              <tr>
                <td className="py-2 pl-4 text-right text-ink">Sub Total</td>
                <td className="py-2 pl-8 pr-4 text-right tabular-nums text-ink">{num2(subtotal)}</td>
              </tr>
              {discountPct > 0 && (
                <tr>
                  <td className="py-2 pl-4 text-right text-ink">Discount ({discountPct}%)</td>
                  <td className="py-2 pl-8 pr-4 text-right tabular-nums text-ink">−{num2(discountAmt)}</td>
                </tr>
              )}
              <tr>
                <td className="py-2 pl-4 text-right font-bold text-ink">Total</td>
                <td className="py-2 pl-8 pr-4 text-right font-bold tabular-nums text-ink">{usd(total)}</td>
              </tr>
              <tr className="bg-[#f3f1ec]">
                <td className="py-3 pl-4 text-right font-bold text-ink">Balance Due</td>
                <td className="py-3 pl-8 pr-4 text-right font-bold tabular-nums text-ink">{usd(balanceDue)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Notes / Terms / Bank */}
        <div className="mt-10 space-y-5 border-t border-line pt-6 text-[12px]">
          {INVOICE_NOTES && (
            <div>
              <div className="font-semibold text-ink">Notes</div>
              <p className="mt-1 text-muted">{INVOICE_NOTES}</p>
            </div>
          )}
          {/* Payment Options — accepted methods, mirroring the reference invoice. Each chip is an
              absolute deep link (`?pay=<method>`) so it stays clickable from a downloaded PDF and
              opens this invoice pre-set to that method: PayPal / card forward to the gateway,
              bank transfer reveals the wire details (see InvoiceAutoPay). */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-ink">Payment Options</span>
            <span className="inline-flex items-center divide-x divide-line overflow-hidden rounded-md border border-line bg-[#fafaf7] text-[11.5px] font-medium text-ink-soft">
              {[
                { label: "PayPal", icon: "🅿️", method: "paypal" },
                { label: "Credit / debit card", icon: "💳", method: "stripe" },
                { label: "Bank transfer", icon: "🏦", method: "bank_transfer" },
              ].map((m) => (
                <a
                  key={m.label}
                  href={`${invoiceUrl}${invoiceUrl.includes("?") ? "&" : "?"}pay=${m.method}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 transition-colors hover:bg-[#f1efe9] hover:text-ink"
                >
                  <span>{m.icon}</span>
                  {m.label}
                </a>
              ))}
            </span>
          </div>
          {INVOICE_CONDITIONS.length > 0 && (
            <div>
              <div className="font-semibold text-ink">Terms &amp; Conditions</div>
              <ol className="mt-1 list-inside list-decimal text-muted">
                {INVOICE_CONDITIONS.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
            </div>
          )}
          {bank.bankName && (
            <div id="bank-transfer" className="scroll-mt-6">
              <div className="font-semibold text-ink">Bank Transfer</div>
              <div className="mt-1 grid grid-cols-2 gap-x-8 gap-y-0.5 text-muted sm:max-w-md">
                {bank.accountName && <Field label="Account holder" value={bank.accountName} />}
                {bank.bankName && <Field label="Bank" value={bank.bankName} />}
                {bank.accountNumber && <Field label="Account №" value={bank.accountNumber} />}
                {bank.routingNumber && <Field label="Routing / ABA" value={bank.routingNumber} />}
                {bank.swift && <Field label="SWIFT / BIC" value={bank.swift} />}
              </div>
              {bank.instructions && <p className="mt-1 text-muted">{bank.instructions}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <span>{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
