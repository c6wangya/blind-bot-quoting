import type { RuleMatcher, WindowLineConfig } from "./types";
import { matcherMatches } from "./validate";
import { formatInches } from "./quote";

// Phase B — manufacturing derivation. Pure: deduction rows in, cut list out. Mirrors the
// anchor factory's MO workbooks: cut = ordered dimension + signed offset, offsets keyed by
// (mount × assembly type). First matching row (by sortOrder) wins; a line with no matching
// row simply yields no cut list (the MO sheet flags it for manual engineering).

export type DeductionComponent = {
  /** inches added to the base dimension (negative = deduction) */
  offset: number;
  base: "width" | "height";
  label: string;
};

export type DeductionRow = {
  id: number;
  lineKey: string;
  label: string;
  matcher: RuleMatcher[];
  components: Record<string, DeductionComponent>;
  sortOrder: number;
  note?: string | null;
};

export type CutLine = {
  componentKey: string;
  label: string;
  inches: number;
  display: string; // eighth-inch fraction form
};

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
    const inches = Math.round((base + c.offset) * 1000) / 1000;
    return { componentKey, label: c.label, inches, display: formatInches(inches) };
  });
}
