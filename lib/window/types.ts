// Window-coverings ERP domain types (spec: docs/superpowers/specs/2026-07-24-window-coverings-erp-v1-design.md).
// Deliberately namespaced away from lib/types.ts — the legacy roller/drapery types stay untouched.
//
// Naming contract (invariant I1): field keys are camelCase and come from blind-bot — render3d
// schema keys for visual axes, EnumSpec-derived keys for commercial extension axes. Select value
// tokens are snake_case EnumSpec canonical form (or the render3d enum values, e.g. 'MOTORIZED').
// Display labels are separate and org-customizable; tokens never carry display text.

// ---------------------------------------------------------------------------
// Conditions (render3d visibleWhen subset)
// ---------------------------------------------------------------------------

export type Condition =
  | { field: string; equals?: unknown; in?: unknown[]; truthy?: boolean }
  | { not: Condition }
  | { anyOf: Condition[] }
  | { allOf: Condition[] };

// ---------------------------------------------------------------------------
// L1 — templates
// ---------------------------------------------------------------------------

export type TemplateSelectOption = {
  value: string | number;
  label: string;
  description?: string;
  hex?: string;
};

export type TemplateFieldControl =
  | { kind: "select"; options: TemplateSelectOption[] }
  | { kind: "toggle" }
  | { kind: "slider"; min: number; max: number; step: number; unit?: string }
  | { kind: "color"; options?: TemplateSelectOption[] }
  | { kind: "image" }
  | { kind: "text"; placeholder?: string };

export type TemplateField = {
  key: string;
  label: string;
  section: string;
  description?: string;
  control: TemplateFieldControl;
  defaultValue: unknown;
  required?: boolean;
  visibleWhen?: Condition;
  enabledWhen?: Condition;
  /** 'threeD' fields exist in the render3d schema; 'commercial' fields are quoting-only extensions. */
  origin: "3d" | "commercial";
  tier?: "common" | "advanced";
};

export type TemplateSection = { key: string; label: string; visibleWhen?: Condition };

export type TemplateDimension = {
  key: string; // 'width' | 'height'
  label: string;
  unit: "in";
  min: number;
  max: number;
  step: number; // 0.125
  display: "fraction_8th" | "decimal";
};

export type WindowTemplate = {
  id: number;
  orgId: number | null;
  lineKey: string; // blind-bot global_subcategories.key
  label: string;
  revision: number;
  status: "draft" | "published" | "archived";
  source?: {
    package: string;
    engineVersion: string;
    schemaVersion: number;
    exportedAt: string;
  } | null;
  fields: TemplateField[];
  sections: TemplateSection[];
  dimensions: TemplateDimension[];
  rules: unknown[]; // render3d WriteRule passthrough (client-side cascades)
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// L2 — merchant products (field policies ≡ blind-bot Product3dScheme FieldPolicy)
// ---------------------------------------------------------------------------

export type FieldPolicy = { isOffered: boolean; labelOverride?: string } & (
  | {
      controlKind: "select";
      allowedValues: (string | number)[];
      defaultValue: string | number;
      optionLabels?: Record<string, string>;
    }
  | { controlKind: "toggle"; defaultValue: boolean }
  | {
      controlKind: "slider";
      range: { min: number; max: number; step: number };
      defaultValue: number;
    }
  | {
      controlKind: "color";
      allowedColors: { optionId: string; label: string; value: string }[]; // #rrggbb lowercase
      defaultValue: string;
    }
  | {
      controlKind: "image";
      allowedPatterns: { patternAssetId: string; label: string; assetUrl: string; priceGroup?: string }[];
      defaultPattern: string | null;
    }
  | { controlKind: "text"; defaultValue: string }
);

export type WindowProduct = {
  id: number;
  orgId: number;
  templateId: number;
  templateRevision: number;
  name: string;
  sku?: string | null;
  description?: string | null;
  status: "draft" | "active" | "archived";
  fieldPolicies: Record<string, FieldPolicy>;
  imageUrl?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// L3 — commerce data
// ---------------------------------------------------------------------------

export type PriceGroup = { id: number; orgId: number; key: string; label?: string | null };

export type PriceGroupMap = {
  id: number;
  productId: number;
  fieldKey: string;
  valueToken: string;
  priceGroupId: number;
};

export type PriceGrid = {
  id: number;
  priceGroupId: number;
  currency: string;
  widthBreaks: number[]; // ascending, inches
  heightBreaks: number[]; // ascending, inches
  cells: (number | null)[][]; // [heightIdx][widthIdx]; null = unmanufacturable
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
};

/** {fieldKey, valueToken} | {fieldKey, anyOf} | {fieldKey, truthy:true} (toggles). */
export type RuleMatcher = { fieldKey: string; valueToken?: string; anyOf?: string[]; truthy?: boolean };

export type SurchargeKind = "flat" | "per_unit" | "percent" | "width_band" | "per_linear_ft";

export type SurchargeRule = {
  id: number;
  productId?: number | null; // null = org-wide
  label: string;
  matcher: RuleMatcher;
  kind: SurchargeKind;
  amount: {
    value?: number; // flat | per_unit | per_linear_ft
    pct?: number; // percent
    breaks?: number[]; // width_band, ascending inches
    values?: number[]; // width_band, parallel to breaks
    dimension?: "width" | "height"; // per_linear_ft
  };
};

export type SizeConstraint = {
  id: number;
  productId?: number | null;
  matcher: RuleMatcher;
  dimension: "width" | "height" | "area_sqft";
  minValue?: number | null;
  maxValue?: number | null;
  message?: string | null;
};

export type DealerAccount = {
  id: number;
  orgId: number;
  name: string;
  contact: Record<string, unknown>;
  qbRef?: string | null;
};

export type AccountFactor = {
  id: number;
  dealerAccountId: number;
  productId?: number | null;
  lineKey?: string | null;
  factor: number;
};

export type FreightRule = {
  id: number;
  method: string;
  label?: string | null;
  matcher: { dimension?: "width" | "height"; gt?: number };
  amount: { perUnit: number };
  sortOrder: number;
};

/** Everything the pure pricing engine needs, loaded once per price call. */
export type WindowPricingData = {
  priceGroups: PriceGroup[];
  priceGroupMaps: PriceGroupMap[];
  priceGrids: PriceGrid[]; // pre-filtered to currently-effective
  surchargeRules: SurchargeRule[]; // ditto
  sizeConstraints: SizeConstraint[];
  factors: AccountFactor[]; // for the dealer account in play (empty for admin preview)
};

// ---------------------------------------------------------------------------
// Line config + computation snapshots (stored on quote_items)
// ---------------------------------------------------------------------------

export type WindowLineConfig = {
  productId: number;
  templateRevision: number;
  room?: string;
  widthIn: number;
  heightIn: number;
  selections: Record<string, unknown>; // fieldKey -> value token / boolean / number / text
  parentItemId?: number; // 2-on-1/3-on-1 child lines (priced 0)
  specialInstructions?: string;
};

export type WindowSurchargeLine = { label: string; kind: SurchargeKind; amount: number };

export type WindowComputation = {
  kind: "window-product";
  productName: string;
  lineKey: string;
  priceGroupKey: string | null;
  gridId: number | null;
  currency: string;
  msrpBase: number;
  surcharges: WindowSurchargeLine[];
  msrpUnit: number; // msrpBase + surcharges
  factor: number;
  unitPrice: number; // dealer price = msrpUnit × factor (0 for child lines)
};

// ---------------------------------------------------------------------------
// Structured validation issues (inline UI display)
// ---------------------------------------------------------------------------

export type ValidationIssue = {
  fieldKey?: string; // absent = line-level (dimensions, pricing)
  code:
    | "NOT_OFFERED"
    | "VALUE_NOT_ALLOWED"
    | "MISSING_REQUIRED"
    | "OUT_OF_RANGE"
    | "DIMENSION_OUT_OF_RANGE"
    | "SIZE_CONSTRAINT"
    | "UNMANUFACTURABLE"
    | "MISSING_PRICE_GROUP"
    | "NO_PRICE_GRID"
    | "NO_ACCOUNT_FACTOR"
    | "UNKNOWN_FIELD";
  message: string;
};

export class WindowPricingError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join("; "));
    this.issues = issues;
  }
}
