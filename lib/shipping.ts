// THE-772 — shipping cost engine. Pure (no DB), so the same math runs on the server (source of
// truth) and in the client summary.
//
// Each motor's shipping mode follows where it's MADE (set per-model by an admin):
//   • fob    — China-made: air/sea, the customer arranges freight → NO domestic shipping charge
//   • ground — US-made: domestic freight per unit at ship_ground (or ship_expedite if expedited)
// A quote can mix both, so shipping is summed PER LINE by each motor's mode. The customer can't pick
// the mode; they may only request expedite (applies to the US-made / ground lines).
//
// Only motor lines are charged this phase; full window-treatment lines and crown/drive parts are
// free. Standard ground is waived for orders ≥ $1000 or for waived retailers; EXPEDITE is a premium,
// charged unless the retailer is explicitly exempted.

import { isAccessoryConfig, type QuoteItemRow } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ShippingMode = "fob" | "ground";
export interface ShippingState {
  mode: ShippingMode;
  expedite: boolean;
}
export const DEFAULT_SHIPPING: ShippingState = { mode: "fob", expedite: false };

/** Orders at or above this subtotal ship standard ground free. */
export const SHIPPING_FREE_THRESHOLD = 1000;
/** Estimated ground arrival, in business days. */
export const GROUND_LEAD_DAYS = 4;

export type ShippingWaiver = "none" | "threshold" | "retailer";

/** A retailer's shipping waivers (special-customer perks). Expedite can only be waived on top of
 *  ground (enforced in the db layer). */
export interface ShippingWaivers {
  ground: boolean;
  expedite: boolean;
}

export interface ShippingResult {
  /** Shipping actually charged (USD), after any waiver. */
  amount: number;
  /** Charge before waiver — lets the UI show "Free (over $1000)" with the struck-through cost. */
  rawAmount: number;
  /** Whether the customer requested expedite (only meaningful when there are US-made lines). */
  expedite: boolean;
  /** The quote has at least one US-made (ground) motor line → domestic freight applies. */
  hasGround: boolean;
  /** The quote has at least one China-made (FOB) motor line → those ship FOB. */
  hasFob: boolean;
  waiver: ShippingWaiver;
  /** Estimated arrival in business days when any ground line exists; null otherwise. */
  leadDays: number | null;
}

/** Per-unit shipping rate + mode for one motor model (0 rate = free, e.g. crown/drive parts). */
export interface MotorRate {
  shipGround?: number;
  shipExpedite?: number;
  shipMode?: ShippingMode;
}
/** Minimal catalog surface needed to price shipping — satisfied by CatalogSnapshot. */
export interface ShippingCatalog {
  model(id: string): MotorRate | undefined;
}

/**
 * Compute shipping for a quote, per line by each motor's made-in mode.
 * @param items     the quote's line items (only accessory/motor lines are charged)
 * @param catalog   live catalog, for each motor's per-unit rate + mode
 * @param expedite  the customer's expedite request (applies to US-made / ground lines)
 * @param subtotal  goods subtotal (post-discount net) — drives the $1000 ground waiver
 * @param waivers   this retailer's shipping waivers ({ ground, expedite })
 */
export function computeShipping(
  items: QuoteItemRow[],
  catalog: ShippingCatalog,
  expedite: boolean,
  subtotal: number,
  waivers: ShippingWaivers
): ShippingResult {
  let raw = 0;
  let hasGround = false;
  let hasFob = false;
  for (const it of items) {
    if (!isAccessoryConfig(it.config)) continue; // only motor lines are charged this phase
    const rate = catalog.model(it.productId);
    if (!rate) continue; // model deleted / unknown → no charge
    if (rate.shipMode === "ground") {
      hasGround = true;
      const per = expedite ? rate.shipExpedite ?? 0 : rate.shipGround ?? 0;
      raw += per * it.qty;
    } else {
      hasFob = true; // China-made → ships FOB, no domestic charge
    }
  }
  raw = round2(raw);

  // Standard ground is waived for waived retailers or large orders. Expedite is a premium — charged
  // by default, waived only for retailers explicitly exempted from it (implies a ground waiver).
  let waiver: ShippingWaiver = "none";
  if (expedite) {
    if (waivers.expedite) waiver = "retailer";
  } else {
    if (waivers.ground) waiver = "retailer";
    else if (subtotal >= SHIPPING_FREE_THRESHOLD) waiver = "threshold";
  }
  const amount = hasGround && waiver === "none" ? raw : 0;
  return {
    amount,
    rawAmount: raw,
    expedite: hasGround && expedite,
    hasGround,
    hasFob,
    waiver,
    leadDays: hasGround ? GROUND_LEAD_DAYS : null,
  };
}
