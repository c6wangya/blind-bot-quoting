// THE-772 — customer-facing invoice document, rendered from a quote (+ its order if converted).
// Pure presentation helpers + the seller's static block. The financial record itself lives on
// the quote/order; this just shapes line items and holds the white-label seller info.
//
// Seller / terms / notes are placeholders overridable per-deploy via env (bank details come from
// the admin-managed app_settings, see lib/db/settings.ts). Fill the real values before issuing.
import { BRAND } from "./brand";
import { getLine, getProduct } from "./db";
import { describeConfig } from "./describe";
import { isAccessoryConfig, type QuoteItemRow, type QuoteRow } from "./types";

/** Bill-To fields an invoice requires (the reference invoice's customer address block). Returns the
 *  human labels of any that are blank — empty array means the quote has complete invoicing details. */
export function invoiceMissingFields(q: QuoteRow): string[] {
  const need: [keyof QuoteRow, string][] = [
    ["customerName", "Customer name"],
    ["shipAddress1", "Address"],
    ["shipCity", "City"],
    ["shipState", "State"],
    ["shipZip", "ZIP"],
  ];
  return need.filter(([k]) => !String(q[k] ?? "").trim()).map(([, label]) => label);
}

/** Whether `userId` may issue an invoice for this quote: it must be their OWN quote (a public demo
 *  quote has ownerId === null and is never invoiceable) AND have complete Bill-To details. */
export function canInvoiceQuote(q: QuoteRow, userId: string): boolean {
  return !!q.ownerId && q.ownerId === userId && invoiceMissingFields(q).length === 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The "from" party on the invoice — the white-label brand. Override via NEXT_PUBLIC_INVOICE_*. */
export const SELLER = {
  name: process.env.NEXT_PUBLIC_INVOICE_SELLER_NAME ?? BRAND.name,
  // Pipe-separated address lines, e.g. "3481 …|Greenwood Indiana 46143|U.S.A".
  addressLines: (process.env.NEXT_PUBLIC_INVOICE_SELLER_ADDRESS ?? "123 Example Street|Suite 000|City, ST 00000|U.S.A")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean),
  taxId: process.env.NEXT_PUBLIC_INVOICE_TAX_ID ?? "00-0000000",
};

export const INVOICE_TERMS_LABEL = process.env.NEXT_PUBLIC_INVOICE_TERMS ?? "Due on Receipt";

/** Footer "Notes" + "Terms & Conditions" — placeholder copy, edit before sending real invoices. */
export const INVOICE_NOTES =
  process.env.NEXT_PUBLIC_INVOICE_NOTES ?? "You can pay by card, PayPal, or bank transfer.";
export const INVOICE_CONDITIONS: string[] = (
  process.env.NEXT_PUBLIC_INVOICE_CONDITIONS ?? "100% due on shipment|Shipping by ground"
)
  .split("|")
  .map((s) => s.trim())
  .filter(Boolean);

/** One row of the invoice's "Item & Description" table. */
export type InvoiceLine = {
  n: number;
  name: string;
  description: string;
  sku: string | null;
  qty: number;
  rate: number;
  amount: number;
};

/** Build the printable line items from a quote's lines — products described in full, accessories
 *  by their snapshotted name/brand/variations. Rate = unit price, amount = rate × qty. */
export function buildInvoiceLines(items: QuoteItemRow[]): InvoiceLine[] {
  return items.map((item, i) => {
    const rate = item.computation.unitPrice;
    const qty = item.qty;
    const base = { n: i + 1, qty, rate, amount: round2(rate * qty) };

    const cfg = item.config;
    if (isAccessoryConfig(cfg)) {
      const variations = (cfg.variations ?? []).map((v) => v.itemLabel).join(", ");
      const description = [cfg.brand, cfg.category, variations].filter(Boolean).join(" · ");
      return { ...base, name: cfg.name, description, sku: cfg.sku };
    }

    const product = getProduct(item.productId);
    const line = product ? getLine(item.lineId) : null;
    if (!product || !line) {
      return { ...base, name: "Custom product", description: "", sku: null };
    }
    const d = describeConfig(line, product, cfg);
    const description = [line.name, d.colorName, d.opacityLabel, ...d.options, d.dims, d.location]
      .filter(Boolean)
      .join(" · ");
    return { ...base, name: product.name, description, sku: product.sku };
  });
}
