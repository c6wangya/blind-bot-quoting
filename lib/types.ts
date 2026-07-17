// Shared domain types for the BlindBots Trade quoting system.

export type ProductLineId = "roller-shade" | "drapery";

/**
 * Opacity (translucency) ids are defined per product line — the roller and drapery
 * vocabularies differ (e.g. roller "privacy" vs drapery "semi-sheer"), sourced from
 * blind-bot's real subcategory schemas. Each line lists its own `opacities`.
 */
export type OpacityId = string;

export interface DimensionField {
  key: string;
  label: string;
  unit: "cm";
  min: number;
  max: number;
  step: number;
  help?: string;
}

export interface OptionChoice {
  id: string;
  name: string;
  hint?: string;
}

export interface OptionGroup {
  key: string;
  label: string;
  options: OptionChoice[];
}

export interface ProductLine {
  id: ProductLineId;
  name: string;
  tagline: string;
  description: string;
  leadTimeDays: number;
  dimensionFields: DimensionField[];
  /** the line's opacity/translucency vocabulary (the producibility + pricing axis) */
  opacities: OptionChoice[];
  optionGroups: OptionGroup[];
}

export type PatternStyle = "solid" | "linen" | "stripe" | "screen" | "botanical" | "geo" | "velvet" | "voile" | "weave";

export type PriceTier = "standard" | "premium" | "designer";

export interface ProductColor {
  id: string;
  name: string;
  hex: string;
  /** secondary hue used by patterned renders (stripes, botanicals…) */
  accentHex?: string;
}

export interface Product {
  id: string;
  lineId: ProductLineId;
  sku: string;
  name: string;
  description: string;
  tier: PriceTier;
  /** real product photo (local, under /public/catalog/...) shown in the configurator + cards */
  imageUrl: string;
  /** additional real photos for the product gallery */
  galleryImages?: string[];
  /** fallback fabric pattern for the small color Swatch (no per-color photos upstream) */
  patternStyle: PatternStyle;
  colors: ProductColor[];
  /** the variation constraint: only these opacity ids (from the line's vocab) are producible */
  validOpacities: OpacityId[];
  featured?: boolean;
}

/** A fully-specified configuration of a product, as stored on a quote line. */
export interface ItemConfig {
  colorId: string;
  opacityId: OpacityId;
  /** answers keyed by option group key, e.g. { mount: "inside", control: "motorized" } */
  options: Record<string, string>;
  /** dimension answers keyed by dimension field key, in cm */
  dimensions: Record<string, number>;
  /** per-line window/room label (which window this line is for) */
  location?: string;
  /** free-text special instructions for the workroom */
  note?: string;
}

/** Config stored on an accessory (e.g. A-OK motor) quote line — no dimensions/options. */
export interface AccessoryConfig {
  kind: "accessory";
  /**
   * The catalog model id this line was priced from — snapshotted so downstream lookups (e.g. the
   * invoice "List" price) resolve the EXACT model. Required for robustness because sku is NOT unique
   * across brand catalogs (the A-OK / B-OK trees reuse skus). Optional only for legacy lines created
   * before this field existed; those fall back to a brand+category+sku match.
   */
  modelId?: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  /** Image URL snapshotted at add time, so the thumbnail survives if the catalog model is deleted. */
  image?: string;
  /** Chosen variation items, snapshotted at add time (THE-772 — 0010). Supersedes crownDriver. */
  variations?: VariationSnapshot[];
  /** Legacy Crown + Driver choice (pre-0010 lines); kept for display of old quotes. */
  crownDriver?: CrownDriverConfig;
  /**
   * Air-freight line: an admin (acting on a retailer's behalf) placed this for an out-of-stock
   * model — it's procured from China, so it does NOT draw/reserve US inventory. Only honored when
   * set by the server (see `POST /api/quote-items`); never trust a client-supplied flag.
   */
  airFreight?: boolean;
}

/**
 * An admin-added ad-hoc money line on a quote — a surcharge (positive) or a discount (negative).
 * Not a catalog product: no stock, no manufacturing, never on the supplier sheet. The amount lives
 * in `computation.unitPrice` (qty is always 1) so it folds through the same `Σ unitPrice × qty`
 * totals as every other line. lineId = "adjustment".
 */
export interface AdjustmentConfig {
  kind: "adjustment";
  /** Human label shown on the quote/invoice, e.g. "Rush handling" or "Loyalty discount". */
  label: string;
  note?: string;
}

/** One chosen variation item, snapshotted onto a quote line. */
export interface VariationSnapshot {
  variationId: string;
  variationName: string;
  itemId: string;
  itemLabel: string;
  price: number;
  /** How many of this sub-part per parent motor unit (THE-772). Absent on pre-qty lines = 1. */
  qty?: number;
}

/** A motor's Crown + Driver selection on a quote line. */
export type CrownDriverConfig =
  | { mode: "not-needed" }
  | {
      mode: "crown-driver";
      crownId: string;
      crownLabel: string;
      crownPriceDelta: number;
      driverId: string;
      driverLabel: string;
      driverPriceDelta: number;
    };

/** Admin-managed Crown/Driver version (a price delta added to the motor's unit price). */
export interface MotorOption {
  id: string;
  label: string;
  priceDelta: number;
  sort: number;
}

/**
 * Admin-managed faceted attribute for accessory models (e.g. "Power", "Compatible
 * products"). `multi` = a model can hold several values of this attribute. Filter/display
 * metadata only — does not affect pricing. See supabase/migrations/0002_accessory_tags.sql.
 */
export interface AccessoryAttribute {
  id: string;
  name: string;
  multi: boolean;
  sort: number;
}

export interface AccessoryAttributeValue {
  id: string;
  attributeId: string;
  label: string;
  sort: number;
}

/**
 * Admin-managed "Compatible variation" — a named + imaged fitment entry attached to one
 * accessory model. Each entry references any number of other catalog models ("items"); on the
 * retailer accessory page they are grouped by category and shown next to the part. A model may
 * have several entries. Display metadata only — does not affect pricing. See
 * supabase/migrations/0041_accessory_compat.sql.
 */
export interface CompatVariation {
  id: string;
  modelId: string;
  name: string;
  imageUrl: string | null;
  sort: number;
  /** ids of the catalog models checked in this entry. */
  itemIds: string[];
}

/** A resolved compatible-item group for display: category name + the item labels within it. */
export interface CompatItemGroup {
  category: string;
  items: { id: string; name: string; sku: string; imageUrl: string | null }[];
}

/** A compatible variation resolved for retailer display: name + image + items grouped by category. */
export interface CompatVariationView {
  id: string;
  name: string;
  imageUrl: string | null;
  groups: CompatItemGroup[];
}

export interface BreakdownLine {
  label: string;
  detail?: string;
  amount: number;
}

export interface QuoteComputation {
  unitPrice: number;
  currency: "USD";
  lines: BreakdownLine[];
  /** derived manufacturing facts (fabric meters, panel count…) surfaced in the UI and the supplier Excel */
  facts: { label: string; value: string }[];
  pricingVersion: string;
  /**
   * Admin per-quote price override (THE-772) for FULL PRODUCT lines: a flat special unit price for
   * this quote only. `unitPrice` IS `value`; `standard` is the computed price it replaced (refreshed
   * on every re-price, for "was $X" display). Survives qty re-prices — only an admin sets/clears it.
   */
  priceOverride?: { value: number; standard: number; by: string; at: string };
  /**
   * Admin per-quote price override for ACCESSORY lines, at component granularity: a custom motor base
   * price and/or per-sub-part unit price (keyed by variation item id). Whatever isn't overridden falls
   * back to the catalog/standard price. `unitPrice` is recomputed from these. Survives qty/sub-part
   * edits; cleared by an admin Reset. Absent = standard prices.
   */
  componentPrices?: { motor?: number; items?: Record<string, number>; by: string; at: string };
}

export type QuoteStatus = "draft" | "converted";

export interface QuoteItemRow {
  id: number;
  quoteId: number;
  productId: string;
  lineId: ProductLineId | "accessory" | "adjustment";
  qty: number;
  config: ItemConfig | AccessoryConfig | AdjustmentConfig;
  computation: QuoteComputation;
  createdAt: string;
}

/** True for an accessory (e.g. A-OK motor) quote line. */
export function isAccessoryConfig(c: ItemConfig | AccessoryConfig | AdjustmentConfig): c is AccessoryConfig {
  return (c as AccessoryConfig).kind === "accessory";
}

/** True for an admin-added ad-hoc surcharge/discount line. */
export function isAdjustmentConfig(c: ItemConfig | AccessoryConfig | AdjustmentConfig): c is AdjustmentConfig {
  return (c as AdjustmentConfig).kind === "adjustment";
}

/**
 * Composite lookup key for an accessory catalog price when the model id isn't known (legacy lines).
 * sku alone is NOT unique — the A-OK / B-OK brand catalogs reuse skus — so a lookup must also carry
 * the brand and category. Uses a control char separator that can't occur in a name. Prefer matching
 * by `AccessoryConfig.modelId` when present; this is the fallback.
 */
export function accessoryListKey(brand: string, category: string, sku: string): string {
  return `${brand}${category}${sku}`;
}

export interface QuoteRow {
  id: number;
  ref: string;
  retailer: string;
  status: QuoteStatus;
  /** Owning retailer (auth uid); NULL = public demo quote (not invoiceable). */
  ownerId: string | null;
  projectName: string | null;
  /** Optional human-friendly name; when set, lists prefer it over `ref`. NULL = unnamed. */
  quoteName: string | null;
  // Enriched header details (THE-772 — see supabase/migrations/0003_quote_details.sql).
  quoteType: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  shipAddress1: string | null;
  shipAddress2: string | null;
  shipCity: string | null;
  shipState: string | null;
  shipZip: string | null;
  po: string | null;
  sidemark: string | null;
  /** Extra emails for the primary customer (all also receive the order confirmation). */
  customerEmails: string[];
  /** Additional order-confirmation recipients beyond customerEmail. */
  contacts: Contact[];
  createdAt: string;
  updatedAt: string;
}

/** A customer contact / notification recipient. Name, phone, and ≥1 email are all required.
 *  A single contact (one person/unit) can carry several email addresses. */
export interface Contact {
  name: string;
  phone: string;
  emails: string[];
}

/** Editable quote header details — customer, ship-to, and references. All optional. */
export interface QuoteDetails {
  quoteType?: string;
  quoteName?: string | null;
  projectName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerEmails?: string[];
  shipAddress1?: string | null;
  shipAddress2?: string | null;
  shipCity?: string | null;
  shipState?: string | null;
  shipZip?: string | null;
  po?: string | null;
  sidemark?: string | null;
  contacts?: Contact[];
}

/** A saved address-book entry — a reusable QuoteDetails preset owned by a retailer. */
export type SavedAddress = QuoteDetails & {
  id: string;
  label: string | null;
  isDefault: boolean;
};

// Full fulfilment pipeline — used by PRODUCT orders (6 steps).
export const ORDER_STATUSES = [
  "submitted",
  "acknowledged",
  "in_production",
  "shipped",
  "in_transit",
  "delivered",
] as const;

// Accessory-only orders use a collapsed 3-step flow: payment auto-completes `acknowledged`, then
// the supplier ships (terminal). The `accessory_only` flag on the order selects which list applies.
export const ORDER_STATUSES_ACCESSORY = ["submitted", "acknowledged", "shipped"] as const;

// 'awaiting_payment' is the pre-pipeline state; 'cancelled' (unpaid) and 'refunded' (paid, then
// returned before shipment) are terminal. The manual advance machine covers only ORDER_STATUSES.
export type OrderStatus =
  | (typeof ORDER_STATUSES)[number]
  | "awaiting_payment"
  | "cancelled"
  | "refunded";

export type PaymentMethod = "stripe" | "paypal" | "bank_transfer";
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

// A paid order can be refunded at any fulfilment stage (full amount).
export const REFUNDABLE_STATUSES = ORDER_STATUSES;
// Pre-shipment stages: refunding here releases the reserved motor stock back (goods never left).
// Refunding a shipped/in-transit/delivered order does NOT touch stock — the goods are already out.
export const PRE_SHIPMENT_STATUSES = ["submitted", "acknowledged", "in_production"] as const;

export interface OrderRow {
  id: number;
  ref: string;
  quoteId: number;
  status: OrderStatus;
  supplierOrderNo: string | null;
  trackingNo: string | null;
  /** All tracking numbers for the shipment (an order can ship in several parcels). */
  trackingNos: string[] | null;
  carrier: string | null;
  /** True when every line is an accessory → collapsed 3-step flow + manual tracking entry. */
  accessoryOnly: boolean;
  etaDate: string | null;
  paymentMethod: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  paymentRef: string | null;
  amount: number | null;
  /** Order-level % discount snapshotted from the retailer at submit (0 = none). amount is already net. */
  discountPct: number;
  paidAt: string | null;
  paymentProofPath: string | null;
  /** Admin's reason for the refund (set when status === "refunded"). */
  refundReason: string | null;
  /** Optional supporting documents for the refund (private bucket paths). */
  refundDocPaths: string[] | null;
  refundedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderEventRow {
  id: number;
  orderId: number;
  status: OrderStatus | "note";
  note: string;
  actor: "retailer" | "supplier" | "logistics" | "system";
  createdAt: string;
}

export interface PricingVersionRow {
  id: number;
  lineId: ProductLineId;
  version: string;
  active: boolean;
  note: string;
  config: RollerPricingConfig | DraperyPricingConfig;
  createdAt: string;
}

// ---- pricing engine configs (versioned, stored as JSON in DB) ----

export interface RollerPricingConfig {
  kind: "roller-grid";
  currency: "USD";
  /** ascending width breakpoints (cm) — a shade prices at the first breakpoint >= its width */
  gridWidths: number[];
  /** ascending height breakpoints (cm) */
  gridHeights: number[];
  /** prices[widthIdx][heightIdx] — base trade price for the standard tier */
  prices: number[][];
  tierMultiplier: Record<PriceTier, number>;
  opacityMultiplier: Record<OpacityId, number>;
  optionSurcharges: Record<string, Record<string, number>>;
  minCharge: number;
}

export interface DraperyPricingConfig {
  kind: "drapery-formula";
  currency: "USD";
  fabricBoltWidthCm: number;
  headerAllowanceCm: number;
  hemAllowanceCm: number;
  fabricPricePerMeter: Record<PriceTier, number>;
  opacitySurchargePerMeter: Record<OpacityId, number>;
  /** sewing cost applied per fabric width */
  makingPerWidth: Record<string, number>;
  liningPerMeter: Record<string, number>;
  controlFlat: Record<string, number>;
  fullnessFactor: Record<string, number>;
  minCharge: number;
}
