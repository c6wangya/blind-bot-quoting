import type { RuleMatcher, WindowLineConfig } from "./types";
import { matcherMatches } from "./validate";
import { formatInches } from "./quote";

// Phase B — manufacturing derivation. Pure: deduction rows in, cut list + hardware parts out.
// Mirrors the anchor factory's MO workbooks: cut = base dimension × multiplier + offset, keyed
// by (mount × assembly type). The multiplier covers formulas like zebra fabric length = 2×drop
// + 12 (the banded fabric is a doubled loop). First matching row (by sortOrder) wins; a line
// with no matching row yields nothing (the MO sheet flags it for manual engineering).

export type DeductionComponent = {
  /** inches added after scaling (negative = deduction) */
  offset: number;
  base: "width" | "height";
  /** scale on the base dimension before the offset; default 1 (zebra fabric length uses 2) */
  multiplier?: number;
  label: string;
};

/** Hardware/part quantity rule: fixed per unit, or stepped by width band (anchor bracket rules). */
export type PartRule = {
  key: string; // 'bracket' | 'screw' | ...
  label: string;
  qtyRule:
    | { kind: "per_unit"; value: number }
    | { kind: "width_band"; breaks: number[]; values: number[] }; // round-up bands like pricing
};

export type DeductionRow = {
  id: number;
  lineKey: string;
  label: string;
  matcher: RuleMatcher[];
  components: Record<string, DeductionComponent>;
  parts?: PartRule[];
  sortOrder: number;
  note?: string | null;
};

export type CutLine = {
  componentKey: string;
  label: string;
  inches: number;
  display: string; // eighth-inch fraction form
};

export type PartLine = { key: string; label: string; qty: number };

/** The deduction row applying to this line's effective selections, or null. */
export function matchDeductionRow(
  rows: DeductionRow[],
  lineKey: string,
  effective: Record<string, unknown>
): DeductionRow | null {
  const candidates = rows
    .filter((r) => r.lineKey === lineKey)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const row of candidates) {
    if (row.matcher.every((m) => matcherMatches(m, effective))) return row;
  }
  return null;
}

/** Cut list for one window line. */
export function deriveCutList(
  row: DeductionRow,
  config: Pick<WindowLineConfig, "widthIn" | "heightIn">
): CutLine[] {
  return Object.entries(row.components).map(([componentKey, c]) => {
    const base = c.base === "width" ? config.widthIn : config.heightIn;
    const inches = Math.round((base * (c.multiplier ?? 1) + c.offset) * 1000) / 1000;
    return { componentKey, label: c.label, inches, display: formatInches(inches) };
  });
}

/** Hardware parts for one line (per shade; multiply by line qty for order totals). */
export function derivePartsList(
  row: DeductionRow,
  config: Pick<WindowLineConfig, "widthIn">
): PartLine[] {
  return (row.parts ?? []).map((p) => {
    let qty = 0;
    if (p.qtyRule.kind === "per_unit") qty = p.qtyRule.value;
    else {
      const { breaks, values } = p.qtyRule;
      let i = breaks.findIndex((b) => config.widthIn <= b);
      if (i === -1) i = values.length - 1; // beyond last break = largest band
      qty = values[i] ?? 0;
    }
    return { key: p.key, label: p.label, qty };
  });
}

// ---------------------------------------------------------------------------
// Order-level production aggregates (QC checklist / packing slip counts) — derived from the
// snapshotted effective selections of window lines, matching the anchor QC sheet's counters.
// ---------------------------------------------------------------------------

export type ProductionAggregates = {
  totalLines: number;
  totalUnits: number;
  motorizedUnits: number;
  cordlessUnits: number;
  remoteUnits: number;
  chargerUnits: number;
  hubUnits: number;
  batteryPackUnits: number;
  sideChannelUnits: number;
  reverseRollUnits: number;
  holdDownUnits: number;
  fabricColorCounts: Record<string, number>; // color token -> units
  topTreatmentCounts: Record<string, number>;
};

export function deriveAggregates(
  lines: { selections: Record<string, unknown>; qty: number }[]
): ProductionAggregates {
  const agg: ProductionAggregates = {
    totalLines: lines.length,
    totalUnits: 0,
    motorizedUnits: 0,
    cordlessUnits: 0,
    remoteUnits: 0,
    chargerUnits: 0,
    hubUnits: 0,
    batteryPackUnits: 0,
    sideChannelUnits: 0,
    reverseRollUnits: 0,
    holdDownUnits: 0,
    fabricColorCounts: {},
    topTreatmentCounts: {},
  };
  for (const { selections: s, qty } of lines) {
    agg.totalUnits += qty;
    if (s.control === "MOTORIZED") agg.motorizedUnits += qty;
    if (s.control === "CORDLESS") agg.cordlessUnits += qty;
    if (s.remoteChannels && s.remoteChannels !== "none") agg.remoteUnits += qty;
    if (s.charger && s.charger !== "none") agg.chargerUnits += qty;
    if (s.smartHub === true) agg.hubUnits += qty;
    if (s.batteryPack === true) agg.batteryPackUnits += qty;
    if (s.sideChannels === true) agg.sideChannelUnits += qty;
    if (s.rollType === "REVERSE") agg.reverseRollUnits += qty;
    if (s.holdDownMagnet === true) agg.holdDownUnits += qty;
    const color = typeof s.fabricColor === "string" ? s.fabricColor : null;
    if (color) agg.fabricColorCounts[color] = (agg.fabricColorCounts[color] ?? 0) + qty;
    const top = typeof s.topTreatment === "string" ? s.topTreatment : null;
    if (top) agg.topTreatmentCounts[top] = (agg.topTreatmentCounts[top] ?? 0) + qty;
  }
  return agg;
}
