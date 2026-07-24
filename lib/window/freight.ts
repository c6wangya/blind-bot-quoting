import type { FreightRule } from "./types";
import { isWindowConfig } from "./quote";
import type { QuoteItemRow } from "@/lib/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Freight for window-product lines (anchor model: UPS Ground $7/unit stepping to $95/unit over
// 93.875″ width; Will Call free). Separate from lib/shipping.ts — that engine is motor-made-in
// oriented and window lines are invisible to it, so the two never interact.
//
// Rule matching: all rules of the method whose matcher passes ({} always; {dimension, gt}
// compares the line's dimension); the highest sort_order match wins (base rule first, oversize
// override after). No matching rule = $0 for that line.

export function computeWindowFreight(
  items: Pick<QuoteItemRow, "config" | "qty">[],
  rules: FreightRule[],
  method: string
): number {
  const methodRules = rules
    .filter((r) => r.method === method)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  if (methodRules.length === 0) return 0;

  let total = 0;
  for (const item of items) {
    if (!isWindowConfig(item.config)) continue;
    if (item.config.parentItemId != null) continue; // 2-on-1 children ride with the parent
    const dims = { width: item.config.widthIn, height: item.config.heightIn };
    let picked: FreightRule | null = null;
    for (const rule of methodRules) {
      const m = rule.matcher ?? {};
      if (m.dimension && m.gt != null) {
        if (dims[m.dimension] > m.gt) picked = rule;
      } else {
        picked = picked ?? rule; // unconditional base rule
      }
    }
    if (picked) total += (picked.amount.perUnit ?? 0) * item.qty;
  }
  return round2(total);
}
