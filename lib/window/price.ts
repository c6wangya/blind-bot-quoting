import type {
  PriceGrid,
  ValidationIssue,
  WindowComputation,
  WindowLineConfig,
  WindowPricingData,
  WindowProduct,
  WindowTemplate,
} from "./types";
import { WindowPricingError } from "./types";
import { matcherMatches, validateWindowConfig } from "./validate";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Pricing engine for window-product lines. One interpreter, no per-product code (spec §6):
//
//   msrpUnit  = grid(priceGroup(selections), W, H)   — round UP to next break; null cell = can't make
//             + Σ surcharge rules matching selections — flat | per_unit | percent | width_band | per_linear_ft
//   unitPrice = msrpUnit × accountFactor              — most-specific factor; no implicit 1.0
//
// Freight/tax are order-level (quote submit), not per-line. Child lines (2-on-1) price to 0 but
// still validate. The server always re-prices; client price is never trusted.

/** Round-up break lookup: first break >= v. Returns -1 when v exceeds the largest break. */
function breakIndex(breaks: number[], v: number): number {
  for (let i = 0; i < breaks.length; i++) if (v <= breaks[i]) return i;
  return -1;
}

function gridPrice(grid: PriceGrid, widthIn: number, heightIn: number): number | null | undefined {
  const wi = breakIndex(grid.widthBreaks, widthIn);
  const hi = breakIndex(grid.heightBreaks, heightIn);
  if (wi === -1 || hi === -1) return undefined; // beyond grid = out of range
  return grid.cells[hi]?.[wi] ?? null;
}

export function priceWindowLine(args: {
  template: WindowTemplate;
  product: WindowProduct;
  config: WindowLineConfig;
  pricing: WindowPricingData;
  lineKey: string;
  /** Admin previews price at MSRP (factor 1); dealers must resolve a factor. */
  factorOverride?: number;
}): WindowComputation {
  const { template, product, config, pricing, lineKey, factorOverride } = args;

  const { issues, effective } = validateWindowConfig({ template, product, config, pricing });
  if (issues.length) throw new WindowPricingError(issues);

  // Child lines of a 2-on-1/3-on-1 group share the parent's headrail and price 0 by the anchor
  // customer's convention — validated above, priced here as zero.
  if (config.parentItemId != null) {
    return {
      kind: "window-product",
      productName: product.name,
      lineKey,
      priceGroupKey: null,
      gridId: null,
      currency: "USD",
      msrpBase: 0,
      surcharges: [],
      msrpUnit: 0,
      factor: 0,
      unitPrice: 0,
    };
  }

  const pricingIssues: ValidationIssue[] = [];

  // -- price group: first map row whose (fieldKey, valueToken) matches the selections ---------
  const mapRow = pricing.priceGroupMaps.find(
    (m) => m.productId === product.id && String(effective[m.fieldKey]) === m.valueToken
  );
  const group = mapRow ? pricing.priceGroups.find((g) => g.id === mapRow.priceGroupId) : undefined;
  if (!group) {
    throw new WindowPricingError([
      {
        code: "MISSING_PRICE_GROUP",
        message: "No price group is mapped for this fabric/option selection",
      },
    ]);
  }

  // -- grid (already filtered to currently-effective; newest wins) ----------------------------
  const grid = pricing.priceGrids
    .filter((g) => g.priceGroupId === group.id)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
  if (!grid) {
    throw new WindowPricingError([
      { code: "NO_PRICE_GRID", message: `No price grid for group ${group.key}` },
    ]);
  }
  const base = gridPrice(grid, config.widthIn, config.heightIn);
  if (base === undefined) {
    throw new WindowPricingError([
      {
        code: "UNMANUFACTURABLE",
        message: `Size ${config.widthIn}″ × ${config.heightIn}″ exceeds the maximum for this product`,
      },
    ]);
  }
  if (base === null) {
    throw new WindowPricingError([
      {
        code: "UNMANUFACTURABLE",
        message: `Size ${config.widthIn}″ × ${config.heightIn}″ is not manufacturable in this fabric`,
      },
    ]);
  }

  // -- surcharges ------------------------------------------------------------------------------
  const surcharges: WindowComputation["surcharges"] = [];
  for (const rule of pricing.surchargeRules) {
    if (rule.productId != null && rule.productId !== product.id) continue;
    if (!matcherMatches(rule.matcher, effective)) continue;
    let amount = 0;
    switch (rule.kind) {
      case "flat":
      case "per_unit":
        amount = rule.amount.value ?? 0;
        break;
      case "percent":
        amount = round2((base * (rule.amount.pct ?? 0)) / 100);
        break;
      case "width_band": {
        const breaks = rule.amount.breaks ?? [];
        const values = rule.amount.values ?? [];
        const i = breakIndex(breaks, config.widthIn);
        amount = i === -1 ? values[values.length - 1] ?? 0 : values[i] ?? 0;
        break;
      }
      case "per_linear_ft": {
        const dim = rule.amount.dimension === "width" ? config.widthIn : config.heightIn;
        amount = round2((rule.amount.value ?? 0) * (dim / 12));
        break;
      }
    }
    if (amount !== 0) surcharges.push({ label: rule.label, kind: rule.kind, amount });
  }
  const msrpUnit = round2(base + surcharges.reduce((s, l) => s + l.amount, 0));

  // -- account factor: (dealer, product) → (dealer, lineKey) → (dealer, blanket) ---------------
  let factor = factorOverride ?? null;
  if (factor == null) {
    const byProduct = pricing.factors.find((f) => f.productId === product.id);
    const byLine = pricing.factors.find((f) => f.productId == null && f.lineKey === lineKey);
    const blanket = pricing.factors.find((f) => f.productId == null && f.lineKey == null);
    factor = byProduct?.factor ?? byLine?.factor ?? blanket?.factor ?? null;
  }
  if (factor == null) {
    // No implicit 1.0 — an unpriced dealer must fail loudly, never silently buy at MSRP.
    pricingIssues.push({
      code: "NO_ACCOUNT_FACTOR",
      message: "No pricing factor is configured for this account",
    });
    throw new WindowPricingError(pricingIssues);
  }

  return {
    kind: "window-product",
    productName: product.name,
    lineKey,
    priceGroupKey: group.key,
    gridId: grid.id,
    currency: grid.currency,
    msrpBase: base,
    surcharges,
    msrpUnit,
    factor,
    unitPrice: round2(msrpUnit * factor),
  };
}
