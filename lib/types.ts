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
  sku: string;
  name: string;
  brand: string;
  category: string;
  /** Crown + Driver choice, snapshotted at add time (THE-772 — 0005). */
  crownDriver?: CrownDriverConfig;
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
}

export type QuoteStatus = "draft" | "converted";

export interface QuoteItemRow {
  id: number;
  quoteId: number;
  productId: string;
  lineId: ProductLineId | "accessory";
  qty: number;
  config: ItemConfig | AccessoryConfig;
  computation: QuoteComputation;
  createdAt: string;
}

/** True for an accessory (e.g. A-OK motor) quote line. */
export function isAccessoryConfig(c: ItemConfig | AccessoryConfig): c is AccessoryConfig {
  return (c as AccessoryConfig).kind === "accessory";
}

export interface QuoteRow {
  id: number;
  ref: string;
  retailer: string;
  status: QuoteStatus;
  projectName: string | null;
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
  createdAt: string;
  updatedAt: string;
}

/** Editable quote header details — customer, ship-to, and references. All optional. */
export interface QuoteDetails {
  quoteType?: string;
  projectName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  shipAddress1?: string | null;
  shipAddress2?: string | null;
  shipCity?: string | null;
  shipState?: string | null;
  shipZip?: string | null;
  po?: string | null;
  sidemark?: string | null;
}

export const ORDER_STATUSES = [
  "submitted",
  "acknowledged",
  "in_production",
  "shipped",
  "in_transit",
  "delivered",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderRow {
  id: number;
  ref: string;
  quoteId: number;
  status: OrderStatus;
  supplierOrderNo: string | null;
  trackingNo: string | null;
  carrier: string | null;
  etaDate: string | null;
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
