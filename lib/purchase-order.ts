// THE-772 — supplier-facing Purchase Order document, rendered per brand from an order's lines.
// Unlike the customer invoice (lib/invoice.ts) this is for reconciling GOODS with the supplier:
// no payment, no shipping, no discount — just the physical parts (main motor + each accessory
// sub-part broken out) with their counts and OUR COST (进价, accessory_models.cost_price) as the
// unit price, since this is what we pay the supplier — never the customer-facing selling price. The
// issuing party (buyer) is our own white-label brand; the vendor is just the brand string (A-OK …).
import { BRAND } from "./brand";
import {
  getBuyerInfo,
  getCostPriceMap,
  getLine,
  getProduct,
  getSupplierInfo,
  getVariationItemModelMap,
  type BuyerInfo,
  type SupplierInfo,
} from "./db";
import { loadCatalog } from "./db/accessory-catalog";
import { describeConfig } from "./describe";
import { fmtDate } from "./format";
import { isAccessoryConfig, isAdjustmentConfig, type QuoteItemRow } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One row of the PO's parts table — a main product/motor, or a broken-out accessory sub-part. */
export type PurchaseOrderRow = {
  name: string;
  sku: string | null;
  detail: string;
  qty: number;
  rate: number;
  amount: number;
  /** True for accessory sub-parts (crown/drive…) so they can be visually indented under the motor. */
  sub?: boolean;
};

/**
 * Break an order's (brand-filtered) lines into supplier reconciliation rows. An accessory motor is
 * split into the motor itself plus one row per variation sub-part, each with its real physical count
 * (motorQty × per-motor qty). A plain product is a single row.
 *
 * Unit price is OUR COST (进价), faithful to the stored data: each physical model carries its own
 * `accessory_models.cost_price`, so the motor is priced directly at its model's cost (NOT netted of
 * sub-parts, unlike the all-in selling price) and each sub-part at its own model's cost. A model with
 * no cost set shows 0 — never a fallback to the selling price. Cost is resolved via `cost.costMap`
 * (model id → cost); sub-parts map their variation `itemId` → source model id via `cost.itemModelMap`.
 * Full products / ad-hoc adjustments have no supplier cost and show 0.
 */
export function buildPurchaseOrderRows(
  items: QuoteItemRow[],
  cost: { costMap: Record<string, number>; itemModelMap: Record<string, string> } = { costMap: {}, itemModelMap: {} },
): PurchaseOrderRow[] {
  const costOf = (modelId: string | null | undefined) => (modelId ? cost.costMap[modelId] ?? 0 : 0);
  const rows: PurchaseOrderRow[] = [];
  for (const item of items) {
    const cfg = item.config;
    if (isAdjustmentConfig(cfg)) {
      // Ad-hoc money line — not a physical good, has no supplier cost.
      rows.push({ qty: item.qty, rate: 0, amount: 0, sku: null, name: cfg.label, detail: cfg.note ?? "" });
      continue;
    }
    if (isAccessoryConfig(cfg)) {
      const variations = cfg.variations ?? [];
      const motorRate = costOf(cfg.modelId);
      rows.push({
        name: cfg.name,
        sku: cfg.sku,
        detail: [cfg.brand, cfg.category, cfg.airFreight ? "Air freight / 空运" : null].filter(Boolean).join(" · "),
        qty: item.qty,
        rate: motorRate,
        amount: round2(motorRate * item.qty),
      });
      for (const v of variations) {
        const qty = item.qty * (v.qty ?? 1);
        const rate = costOf(cost.itemModelMap[v.itemId]);
        rows.push({
          name: v.itemLabel,
          sku: null,
          detail: `${cfg.name} · ${v.variationName}`,
          qty,
          rate,
          amount: round2(rate * qty),
          sub: true,
        });
      }
      continue;
    }
    const product = getProduct(item.productId);
    const line = product ? getLine(item.lineId) : null;
    // Full products have no cost_price — faithful to the data, cost is 0.
    const rate = costOf(item.productId);
    const base = { qty: item.qty, rate, amount: round2(rate * item.qty), sku: product?.sku ?? null };
    if (!product || !line) {
      rows.push({ ...base, name: "Custom product", detail: "" });
      continue;
    }
    const d = describeConfig(line, product, cfg);
    rows.push({
      ...base,
      name: product.name,
      detail: [line.name, d.colorName, d.opacityLabel, ...d.options, d.dims].filter(Boolean).join(" · "),
    });
  }
  return rows;
}

/** The brand a line belongs to — the accessory's own brand, else our white-label brand. */
export function brandOfItem(it: QuoteItemRow): string {
  return isAccessoryConfig(it.config) ? it.config.brand : BRAND.name;
}

/**
 * The full PO document for one brand of an order — the single source of truth shared by the
 * printable PDF page and the .xlsx export, so both render identical content (Commercial-Invoice
 * core layout: supplier banner + buyer block + parts table + total + supplier bank info).
 * Returns null when the order has no lines for this brand.
 */
export type PurchaseOrderDoc = {
  brand: string;
  supplier: SupplierInfo | null;
  /** Supplier company name, falling back to the raw brand string. */
  supplierName: string;
  buyer: BuyerInfo;
  /** Buyer company name, falling back to our white-label brand. */
  buyerName: string;
  /** Right-hand invoice meta (Date / Order No. / Currency …), label→value. */
  meta: [string, string][];
  rows: PurchaseOrderRow[];
  total: number;
  /** Supplier bank details, label→value; empty when the supplier profile has no bank fields. */
  bank: [string, string][];
};

type PurchaseOrderInput = {
  ref: string;
  createdAt: string;
  quote: {
    ref: string;
    items: QuoteItemRow[];
    projectName?: string | null;
    po?: string | null;
    sidemark?: string | null;
  };
};

export async function buildPurchaseOrderDoc(
  order: PurchaseOrderInput,
  brand: string
): Promise<PurchaseOrderDoc | null> {
  const items = order.quote.items.filter((it) => brandOfItem(it) === brand);
  if (items.length === 0) return null;

  // Resolve this brand's supplier profile (keyed by brand id) + our buyer profile.
  const catalog = await loadCatalog();
  const brandId = catalog.brands.find((b) => b.name === brand)?.id ?? "";
  const [buyer, supplier, costMap, itemModelMap] = await Promise.all([
    getBuyerInfo(),
    brandId ? getSupplierInfo(brandId) : Promise.resolve(null),
    getCostPriceMap(),
    getVariationItemModelMap(),
  ]);
  const hasSupplier = !!supplier && !!supplier.name;

  const rows = buildPurchaseOrderRows(items, { costMap, itemModelMap });
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));

  const q = order.quote;
  const meta: [string, string][] = [
    ["Date", fmtDate(order.createdAt)],
    ["Order No.", order.ref],
    ["Quote Ref", q.ref],
    ["Currency", "USD"],
    ...(q.projectName ? ([["Project", q.projectName]] as [string, string][]) : []),
    ...(q.po ? ([["PO #", q.po]] as [string, string][]) : []),
    ...(q.sidemark ? ([["Sidemark", q.sidemark]] as [string, string][]) : []),
  ];

  const bank = supplier
    ? ([
        ["Beneficiary's Bank Name", supplier.bankName],
        ["Swift code", supplier.swift],
        ["Beneficiary's Name", supplier.beneficiary],
        ["Beneficiary's A/C No.", supplier.accountNumber],
        ["Bank Address", supplier.bankAddress],
      ].filter(([, v]) => v) as [string, string][])
    : [];

  return {
    brand,
    supplier,
    supplierName: hasSupplier ? supplier!.name : brand,
    buyer,
    buyerName: buyer.name || BRAND.name,
    meta,
    rows,
    total,
    bank,
  };
}
