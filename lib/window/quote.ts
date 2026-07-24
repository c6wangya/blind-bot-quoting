import type { QuoteComputation } from "@/lib/types";
import type {
  TemplateField,
  WindowComputation,
  WindowLineConfig,
  WindowTemplate,
} from "./types";

// Bridge between the window pricing engine and the existing quote pipeline. The stored
// computation CONFORMS to QuoteComputation (unitPrice/lines/facts/pricingVersion) so every
// downstream consumer — quote totals, submit, Excel, invoice, refunds — works unchanged;
// the full structured audit rides along under `window` (snapshot discipline: anything a
// rendered line needs is captured here, never looked up live).

export type WindowQuoteConfig = WindowLineConfig & { kind: "window-product" };

export type WindowQuoteComputation = QuoteComputation & { window: WindowComputation };

/** 47.125 → `47 1/8″` (eighth-inch display, the industry's fraction convention). */
export function formatInches(v: number): string {
  const whole = Math.trunc(v);
  const eighths = Math.round((v - whole) * 8);
  if (eighths === 0) return `${whole}″`;
  if (eighths === 8) return `${whole + 1}″`;
  const div = eighths % 2 === 0 ? (eighths % 4 === 0 ? 2 : 4) : 8;
  return `${whole} ${eighths / (8 / div)}/${div}″`;
}

/** Human label for a selection value, resolved from the template field's options. */
function optionLabel(field: TemplateField, value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.control.kind === "select" || field.control.kind === "color") {
    const opt = (field.control.options ?? []).find((o) => o.value === value);
    if (opt) return opt.label;
  }
  return String(value ?? "");
}

/**
 * Display facts for a window line: dimensions first, then the visible non-default selections
 * (room and special instructions render separately). Used by the quote page, supplier Excel
 * and the order acknowledgement — one source for how a window line reads.
 */
export function windowFacts(
  template: WindowTemplate,
  config: WindowLineConfig,
  effective: Record<string, unknown>
): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [
    { label: "Size", value: `${formatInches(config.widthIn)} W × ${formatInches(config.heightIn)} H` },
  ];
  for (const field of template.fields) {
    const v = effective[field.key];
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (v === field.defaultValue && field.control.kind !== "select") continue;
    if (field.control.kind === "slider" && v === field.defaultValue) continue;
    facts.push({ label: field.label, value: optionLabel(field, v) });
  }
  return facts;
}

/** Wrap the engine's computation into the quote pipeline's QuoteComputation shape. */
export function toQuoteComputation(
  comp: WindowComputation,
  facts: { label: string; value: string }[]
): WindowQuoteComputation {
  const lines: QuoteComputation["lines"] = [
    { label: "Base price", detail: comp.priceGroupKey ? `grid ${comp.priceGroupKey}` : undefined, amount: comp.msrpBase },
    ...comp.surcharges.map((s) => ({ label: s.label, amount: s.amount })),
  ];
  if (comp.factor !== 1 && comp.factor !== 0) {
    lines.push({
      label: "Account pricing",
      detail: `× ${comp.factor}`,
      amount: Math.round((comp.unitPrice - comp.msrpUnit) * 100) / 100,
    });
  }
  return {
    unitPrice: comp.unitPrice,
    currency: "USD",
    lines,
    facts,
    pricingVersion: `window:grid${comp.gridId ?? 0}`,
    window: comp,
  };
}

export function isWindowConfig(c: unknown): c is WindowQuoteConfig {
  return typeof c === "object" && c !== null && (c as { kind?: string }).kind === "window-product";
}
