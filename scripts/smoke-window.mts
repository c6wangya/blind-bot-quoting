// End-to-end smoke of the window pricing path against the real DB (no HTTP/auth layer):
// loads the demo product + template + L3 data exactly like loadWindowPricingData does, then
// runs the SAME pure engine the API uses. Expectations mirror scripts/seed-window-demo.mjs.
//
// Run: node --experimental-strip-types scripts/smoke-window.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { priceWindowLine } from "../lib/window/price";
import { WindowPricingError } from "../lib/window/types";
import type { WindowPricingData, WindowProduct, WindowTemplate } from "../lib/window/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const productRow = await db
  .from("catalog_products")
  .select(
    "id, orgId:org_id, templateId:template_id, templateRevision:template_revision, name, sku, status, fieldPolicies:field_policies, sortOrder:sort_order, createdAt:created_at, updatedAt:updated_at"
  )
  .eq("name", "Classic Roller Shade (demo)")
  .single();
if (productRow.error) throw productRow.error;
const product = productRow.data as unknown as WindowProduct;

const templateRow = await db
  .from("product_templates")
  .select("id, orgId:org_id, lineKey:line_key, label, revision, status, source, fields, sections, dimensions, rules, createdAt:created_at, updatedAt:updated_at")
  .eq("id", product.templateId)
  .single();
if (templateRow.error) throw templateRow.error;
const template = templateRow.data as unknown as WindowTemplate;

const [groups, maps, grids, surcharges, constraints, factors] = await Promise.all([
  db.from("price_groups").select("id, orgId:org_id, key, label").eq("org_id", product.orgId),
  db.from("price_group_maps").select("id, productId:product_id, fieldKey:field_key, valueToken:value_token, priceGroupId:price_group_id").eq("product_id", product.id),
  db.from("price_grids").select("id, priceGroupId:price_group_id, currency, widthBreaks:width_breaks, heightBreaks:height_breaks, cells, effectiveFrom:effective_from, effectiveTo:effective_to, note").is("effective_to", null),
  db.from("surcharge_rules").select("id, productId:product_id, label, matcher, kind, amount").is("effective_to", null),
  db.from("size_constraints").select("id, productId:product_id, matcher, dimension, minValue:min_value, maxValue:max_value, message"),
  db.from("account_factors").select("id, dealerAccountId:dealer_account_id, productId:product_id, lineKey:line_key, factor").is("effective_to", null),
]);

const pricingBase = {
  priceGroups: groups.data as never,
  priceGroupMaps: maps.data as never,
  priceGrids: (grids.data as never[]).map((g: never) => ({
    ...(g as object),
    widthBreaks: ((g as { widthBreaks: unknown[] }).widthBreaks ?? []).map(Number),
    heightBreaks: ((g as { heightBreaks: unknown[] }).heightBreaks ?? []).map(Number),
  })),
  surchargeRules: surcharges.data as never,
  sizeConstraints: constraints.data as never,
} as unknown as Omit<WindowPricingData, "factors">;

const dealerPricing: WindowPricingData = {
  ...pricingBase,
  factors: (factors.data as never[]).map((f: never) => ({ ...(f as object), factor: Number((f as { factor: unknown }).factor) })) as never,
};
const msrpPricing: WindowPricingData = { ...pricingBase, factors: [] };

// Synthetic grid formula from the seed — expectations computed, not hardcoded.
const rsa = (w: number, h: number) => Math.round(120 + 1.8 * w + 1.2 * h + 0.045 * w * h);
// Round-up to break: 36×60 uses the (36, 60) cell exactly.
const line = (over: Record<string, unknown> = {}, w = 36, h = 60) => ({
  productId: product.id,
  templateRevision: product.templateRevision,
  widthIn: w,
  heightIn: h,
  selections: { ...over },
});

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
}
function expectError(name: string, fn: () => unknown, code: string) {
  try {
    fn();
    console.log(`✗ ${name} — expected ${code}, got success`);
    failures++;
  } catch (err) {
    const codes = err instanceof WindowPricingError ? err.issues.map((i) => i.code) : [String(err)];
    const ok = codes.includes(code as never);
    console.log(`${ok ? "✓" : "✗"} ${name}${ok ? ` (${code})` : ` — got ${codes.join(",")}`}`);
    if (!ok) failures++;
  }
}

// 1. Base: chain control, white fabric (RSA), 36×60, MSRP preview.
const base = priceWindowLine({ template, product, config: line(), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 });
check("MSRP base 36×60 white → RSA cell", base.msrpBase, rsa(36, 60));
check("  priceGroup", base.priceGroupKey, "RSA");
check("  no surcharges on defaults", base.surcharges.length, 0);
check("  unit = msrp at factor 1", base.unitPrice, base.msrpUnit);

// 2. Round-up: 30×55 must price at the (36, 60) cell.
const ru = priceWindowLine({ template, product, config: line({}, 30, 55), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 });
check("round-up 30×55 → same cell as 36×60", ru.msrpBase, rsa(36, 60));

// 3. Gray fabric routes to RSB (×1.08).
const gray = priceWindowLine({ template, product, config: line({ fabricColor: "#808080" }), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 });
check("gray → RSB", gray.priceGroupKey, "RSB");
check("  RSB = RSA×1.08", gray.msrpBase, Math.round(rsa(36, 60) * 1.08));

// 4. Cordless width-band surcharge: 36" → first band $135; 60" → $180.
const c36 = priceWindowLine({ template, product, config: line({ control: "CORDLESS" }), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 });
check("cordless 36″ surcharge", c36.surcharges.map((s) => s.amount), [135]);
const c60 = priceWindowLine({ template, product, config: line({ control: "CORDLESS" }, 60, 60), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 });
check("cordless 60″ surcharge", c60.surcharges.map((s) => s.amount), [180]);

// 5. Motorized + hub: flat 160 + 185; motorization chain fields become visible/validated.
const moto = priceWindowLine({
  template, product,
  config: line({ control: "MOTORIZED", smartHub: true }),
  pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1,
});
check("motor+hub surcharges", moto.surcharges.map((s) => s.amount).sort((a, b) => a - b), [160, 185]);

// 6. Dealer factor 0.35 resolves from account_factors (line-scoped).
const dealer = priceWindowLine({ template, product, config: line(), pricing: dealerPricing, lineKey: "roller_shade" });
check("dealer factor", dealer.factor, 0.35);
check("dealer unit = msrp×0.35", dealer.unitPrice, Math.round(dealer.msrpUnit * 0.35 * 100) / 100);

// 7. Violations.
expectError("cordless 15″ violates min width 19", () =>
  priceWindowLine({ template, product, config: line({ control: "CORDLESS" }, 15, 60), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 }), "SIZE_CONSTRAINT");
expectError("100″ wide exceeds grid", () =>
  priceWindowLine({ template, product, config: line({}, 100, 60), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 }), "UNMANUFACTURABLE");
expectError("96×108 hits N/A cell", () =>
  priceWindowLine({ template, product, config: line({}, 96, 108), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 }), "UNMANUFACTURABLE");
expectError("disallowed fabric color", () =>
  priceWindowLine({ template, product, config: line({ fabricColor: "#ff0000" }), pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 }), "VALUE_NOT_ALLOWED");
expectError("no factor for unknown dealer", () =>
  priceWindowLine({ template, product, config: line(), pricing: msrpPricing, lineKey: "roller_shade" }), "NO_ACCOUNT_FACTOR");

// 8. Child line (2-on-1) prices 0.
const child = priceWindowLine({ template, product, config: { ...line(), parentItemId: 1 }, pricing: msrpPricing, lineKey: "roller_shade", factorOverride: 1 });
check("2-on-1 child priced 0", child.unitPrice, 0);

// 9. Phase B: deduction derivation (anchor cassette offsets: valance −3/8 IM, tube −1.25,
//    fabric L +12) from live deduction_tables rows.
{
  const { deriveCutList, matchDeductionRow } = await import("../lib/window/production");
  const ded = await db
    .from("deduction_tables")
    .select("id, lineKey:line_key, label, matcher, components, sortOrder:sort_order, note")
    .is("effective_to", null);
  if (ded.error) throw ded.error;
  const rows = ded.data as never[];
  const effective = { mount: "INSIDE", topTreatment: "CASSETTE_SQUARE" };
  const row = matchDeductionRow(rows as never, "roller_shade", effective);
  check("deduction row matched (cassette IM)", row?.label ?? null, "Cassette · Inside Mount");
  if (row) {
    const cuts = deriveCutList(row, { widthIn: 36, heightIn: 60 });
    const byKey = Object.fromEntries(cuts.map((c) => [c.componentKey, c.inches]));
    check("  valance cut = W − 3/8", byKey.valance, 35.625);
    check("  tube cut = W − 1.25", byKey.tube, 34.75);
    check("  fabric length = H + 12", byKey.fabricLength, 72);
    check("  fraction display", cuts.find((c) => c.componentKey === "valance")?.display, "35 5/8″");
  }
  const om = matchDeductionRow(rows as never, "roller_shade", { mount: "OUTSIDE", topTreatment: "FASCIA" });
  check("deduction row matched (fascia OM)", om?.label ?? null, "Fascia · Outside Mount");
}

// 9b. Formula + parts: zebra fabric length = 2×drop + 12; brackets/screws by width band.
{
  const { deriveCutList, derivePartsList, matchDeductionRow } = await import("../lib/window/production");
  const ded = await db
    .from("deduction_tables")
    .select("id, lineKey:line_key, label, matcher, components, parts, sortOrder:sort_order, note")
    .is("effective_to", null);
  if (ded.error) throw ded.error;
  const rows = ded.data as never[];
  const zrow = matchDeductionRow(rows as never, "banded_shade", { mount: "INSIDE", topTreatment: "CASSETTE_SQUARE" });
  check("zebra deduction row matched", zrow?.label ?? null, "Cassette · Inside Mount");
  if (zrow) {
    const cuts = deriveCutList(zrow, { widthIn: 36, heightIn: 60 });
    check("  zebra fabric length = 2×60 + 12", cuts.find((c) => c.componentKey === "fabricLength")?.inches, 132);
    const parts36 = derivePartsList(zrow, { widthIn: 36 });
    check("  brackets ≤60″ → 2", parts36.find((p) => p.key === "bracket")?.qty, 2);
    const parts80 = derivePartsList(zrow, { widthIn: 80 });
    check("  brackets ≤96″ → 3", parts80.find((p) => p.key === "bracket")?.qty, 3);
    const parts120 = derivePartsList(zrow, { widthIn: 120 });
    check("  brackets >96″ → 4", parts120.find((p) => p.key === "bracket")?.qty, 4);
    check("  screws ≤60″ → 4", parts36.find((p) => p.key === "screw")?.qty, 4);
  }
}

// 10. Freight: ground $7/unit, oversize step $95/unit over 93.875″, will_call free.
{
  const { computeWindowFreight } = await import("../lib/window/freight");
  const fr = await db
    .from("freight_rules")
    .select("id, method, label, matcher, amount, sortOrder:sort_order")
    .order("sort_order");
  if (fr.error) throw fr.error;
  const rules = fr.data as never;
  const mk = (widthIn: number, qty: number, parent?: number) => ({
    qty,
    config: { kind: "window-product", productId: 1, templateRevision: 1, widthIn, heightIn: 60, selections: {}, ...(parent ? { parentItemId: parent } : {}) },
  });
  check("freight ground 2 × 36″", computeWindowFreight([mk(36, 2)] as never, rules, "ground"), 14);
  check("freight oversize 96″", computeWindowFreight([mk(96, 1)] as never, rules, "ground"), 95);
  check("freight mixed", computeWindowFreight([mk(36, 1), mk(96, 1)] as never, rules, "ground"), 102);
  check("freight will_call", computeWindowFreight([mk(36, 3)] as never, rules, "will_call"), 0);
  check("freight skips 2-on-1 children", computeWindowFreight([mk(36, 1), mk(36, 1, 99)] as never, rules, "ground"), 7);
}

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
