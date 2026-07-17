// THE-772 — customer-facing invoice document, rendered from a quote (+ its order if converted).
// Pure presentation helpers + the seller's static block. The financial record itself lives on
// the quote/order; this just shapes line items and holds the white-label seller info.
//
// Seller / terms / notes are placeholders overridable per-deploy via env (bank details come from
// the admin-managed app_settings, see lib/db/settings.ts). Fill the real values before issuing.
import { BRAND } from "./brand";
import { getLine, getProduct, getSellerInfo } from "./db";
import { describeConfig } from "./describe";
import { accessoryListKey, isAccessoryConfig, isAdjustmentConfig, type QuoteItemRow, type QuoteRow } from "./types";

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

/**
 * The seller block to actually print: admin-edited values (Settings → Invoice / company info,
 * stored in app_settings) take precedence; any field left blank falls back to the env/brand
 * default in `SELLER`. Call from server components rendering the invoice / purchase order.
 */
export async function getSeller(): Promise<typeof SELLER> {
  const o = await getSellerInfo();
  return {
    name: o.name.trim() || SELLER.name,
    addressLines: o.addressLines.length ? o.addressLines : SELLER.addressLines,
    taxId: o.taxId.trim() || SELLER.taxId,
  };
}

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

/** One priced component of a line, rendered as its OWN table row — the base product itself,
 *  then each add-on part — each with its own Qty / List / Rate / Amount columns. */
export type InvoiceLinePart = {
  label: string;
  /** unit price (Rate) of this component */
  unit: number;
  /** total count of this component on the order (base = line qty; add-on = per-motor qty × line qty) */
  qty: number;
  /** unit × qty (this component's Amount) */
  amount: number;
  /** struck-through Default-tier unit (base = default motor price); null when there's no list tier
   *  (add-on parts have a single price for everyone). */
  listUnit: number | null;
  /** thumbnail for this component's row; null when it has no photo. */
  image: string | null;
};

/** One row of the invoice's "Item & Description" table. */
export type InvoiceLine = {
  n: number;
  name: string;
  description: string;
  sku: string | null;
  qty: number;
  rate: number;
  amount: number;
  /** Thumbnail (snapshotted accessory image / product photo); null for adjustments & custom lines. */
  image: string | null;
  /** Per-unit price split into base product + add-on parts. Only set when the line has add-on parts
   *  (so the customer sees the motor and each accessory priced separately); null otherwise. */
  breakdown: InvoiceLinePart[] | null;
  /** Shared Default-tier "list" unit price, shown struck-through so the customer sees the deal.
   *  null when the line has no Default-tier price (full products, ad-hoc adjustments). */
  listRate: number | null;
  /** listRate × qty; null whenever listRate is null. */
  listAmount: number | null;
};

/**
 * Build the printable line items from a quote's lines — products described in full, accessories
 * by their snapshotted name/brand/variations. Rate = unit price, amount = rate × qty.
 *
 * `defaultPrices` (from getAccessoryDefaultPrices) supplies the shared Default-tier motor price for
 * accessory lines. It resolves by model id when the line snapshotted one (robust — sku is not unique
 * across the A-OK / B-OK catalogs), else by a brand+category+sku key for legacy lines. The line's
 * List price is that default base + the SAME snapshotted variation prices (variations have no
 * per-retailer tier), matching how the actual rate is built.
 */
export function buildInvoiceLines(
  items: QuoteItemRow[],
  defaultPrices: { byId: Record<string, number>; byKey: Record<string, number> } = { byId: {}, byKey: {} },
  itemDetailsById: Record<string, { image: string | null; price: number }> = {},
): InvoiceLine[] {
  return items.map((item, i) => {
    const rate = item.computation.unitPrice;
    const qty = item.qty;
    const base = { n: i + 1, qty, rate, amount: round2(rate * qty), image: null, breakdown: null, listRate: null, listAmount: null };

    const cfg = item.config;
    if (isAdjustmentConfig(cfg)) {
      return { ...base, name: cfg.label, description: cfg.note ?? "", sku: null };
    }
    if (isAccessoryConfig(cfg)) {
      // Variation labels are omitted here — each is rendered as its own priced breakdown row.
      const description = [cfg.brand, cfg.category].filter(Boolean).join(" · ");
      // Resolve the model's List price by id (robust) with a brand+category+sku fallback for legacy
      // lines — sku alone collides across the A-OK / B-OK catalogs.
      const defBase =
        (cfg.modelId != null ? defaultPrices.byId[cfg.modelId] : undefined) ??
        defaultPrices.byKey[accessoryListKey(cfg.brand, cfg.category, cfg.sku)];
      // Each add-on part becomes its own row: total count = per-motor qty × line qty.
      const parts: InvoiceLinePart[] = (cfg.variations ?? []).map((v) => {
        const partQty = (v.qty ?? 1) * qty;
        const det = itemDetailsById[v.itemId];
        return {
          label: [v.variationName, v.itemLabel].filter(Boolean).join(": "),
          unit: v.price,
          qty: partQty,
          amount: round2(v.price * partQty),
          // Part's catalog default price (List) — shown like the motor row, even if it equals Rate.
          listUnit: det?.price ?? null,
          image: det?.image ?? null,
        };
      });
      // Motor's own unit price = line unit price minus its per-motor sub-parts.
      const varSumPerMotor = (cfg.variations ?? []).reduce((s, v) => s + v.price * (v.qty ?? 1), 0);
      const baseUnit = round2(rate - varSumPerMotor);
      const breakdown: InvoiceLinePart[] | null = parts.length
        ? [
            {
              label: cfg.name,
              unit: baseUnit,
              qty,
              amount: round2(baseUnit * qty),
              listUnit: defBase ?? null,
              image: cfg.image ?? null,
            },
            ...parts,
          ]
        : null;
      // Single-row fallback (accessory with no add-on parts): List = the motor's default-tier price.
      const listRate = defBase != null ? round2(defBase + varSumPerMotor) : null;
      const listAmount = listRate != null ? round2(listRate * qty) : null;
      return { ...base, name: cfg.name, description, sku: cfg.sku, image: cfg.image ?? null, breakdown, listRate, listAmount };
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
    return { ...base, name: product.name, description, sku: product.sku, image: product.imageUrl ?? null };
  });
}
