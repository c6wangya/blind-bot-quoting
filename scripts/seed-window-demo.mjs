#!/usr/bin/env node
// Demo/e2e seed for the window ERP: one roller product with policies, RSA/RSB price groups,
// W×H grids, anchor-style surcharges (cordless width-band, motor flat, hub flat), size
// constraints, and a dealer account at factor 0.35. Idempotent-ish: skips if the demo
// product already exists. Values mirror the anchor customer's Excel patterns.
//
// Usage: node scripts/seed-window-demo.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PRODUCT_NAME = "Classic Roller Shade (demo)";

const { data: org } = await db.from("orgs").select("id").order("id").limit(1).single();
const orgId = org.id;

// Freight rules (runs even when the product already exists — added in a later revision).
// Anchor model: UPS Ground $7/unit, stepping to $95/unit over 93.875" width; Will Call free.
const { count: freightCount } = await db
  .from("freight_rules")
  .select("*", { count: "exact", head: true })
  .eq("org_id", orgId);
if ((freightCount ?? 0) === 0) {
  await db.from("freight_rules").insert([
    { org_id: orgId, method: "ground", label: "UPS Ground", matcher: {}, amount: { perUnit: 7 }, sort_order: 0 },
    { org_id: orgId, method: "ground", label: "UPS Ground oversize (>93.875\")", matcher: { dimension: "width", gt: 93.875 }, amount: { perUnit: 95 }, sort_order: 1 },
    { org_id: orgId, method: "will_call", label: "Will Call", matcher: {}, amount: { perUnit: 0 }, sort_order: 0 },
  ]);
  console.log("freight rules seeded (ground + will_call)");
}

const { data: existing } = await db.from("catalog_products").select("id").eq("name", PRODUCT_NAME).maybeSingle();
if (existing) {
  console.log(`demo product already exists (id ${existing.id}) — nothing to do`);
  process.exit(0);
}

const { data: template } = await db
  .from("product_templates")
  .select("id, revision")
  .eq("line_key", "roller_shade")
  .eq("status", "published")
  .order("revision", { ascending: false })
  .limit(1)
  .single();

// Colors follow the 3D contract: lowercase hex values; tokens for price routing are the hexes.
const COLORS = [
  { optionId: "white", label: "White", value: "#ffffff" },
  { optionId: "cream", label: "Cream", value: "#fffdd0" },
  { optionId: "gray", label: "Gray", value: "#808080" },
];

const { data: product } = await db
  .from("catalog_products")
  .insert({
    org_id: orgId,
    template_id: template.id,
    template_revision: template.revision,
    name: PRODUCT_NAME,
    sku: "DEMO-RS-01",
    status: "active",
    field_policies: {
      fabricColor: {
        isOffered: true,
        controlKind: "color",
        allowedColors: COLORS,
        defaultValue: "#ffffff",
      },
    },
  })
  .select("id")
  .single();
console.log(`product: ${PRODUCT_NAME} (id ${product.id})`);

// Price groups + grids. Deterministic synthetic MSRP so smoke expectations are computable:
// RSA(w,h) = round(120 + 1.8w + 1.2h + 0.045wh), RSB = RSA × 1.08. 96"-wide × >96" tall = N/A.
const WIDTHS = [24, 36, 48, 60, 72, 84, 96];
const HEIGHTS = [36, 48, 60, 72, 84, 96, 108, 120];
const rsa = (w, h) => Math.round(120 + 1.8 * w + 1.2 * h + 0.045 * w * h);

const groups = {};
for (const key of ["RSA", "RSB"]) {
  const { data } = await db
    .from("price_groups")
    .upsert({ org_id: orgId, key, label: `Fabric group ${key.slice(-1)}` }, { onConflict: "org_id,key" })
    .select("id")
    .single();
  groups[key] = data.id;
}
for (const [key, mult] of [["RSA", 1], ["RSB", 1.08]]) {
  const cells = HEIGHTS.map((h) =>
    WIDTHS.map((w) => (w === 96 && h > 96 ? null : Math.round(rsa(w, h) * mult)))
  );
  await db.from("price_grids").insert({
    org_id: orgId,
    price_group_id: groups[key],
    width_breaks: WIDTHS,
    height_breaks: HEIGHTS,
    cells,
    note: "demo seed",
  });
}
console.log(`price groups + grids: RSA, RSB (${WIDTHS.length}×${HEIGHTS.length})`);

// Fabric color → group routing (white/cream = A, gray = B — the anchor pattern).
await db.from("price_group_maps").insert([
  { org_id: orgId, product_id: product.id, field_key: "fabricColor", value_token: "#ffffff", price_group_id: groups.RSA },
  { org_id: orgId, product_id: product.id, field_key: "fabricColor", value_token: "#fffdd0", price_group_id: groups.RSA },
  { org_id: orgId, product_id: product.id, field_key: "fabricColor", value_token: "#808080", price_group_id: groups.RSB },
]);

// Surcharges straight out of the anchor workbooks' shapes.
await db.from("surcharge_rules").insert([
  {
    org_id: orgId, product_id: product.id, label: "Cordless",
    matcher: { fieldKey: "control", valueToken: "CORDLESS" },
    kind: "width_band", amount: { breaks: [48, 72, 96], values: [135, 180, 250] },
  },
  {
    org_id: orgId, product_id: product.id, label: "Motor",
    matcher: { fieldKey: "control", valueToken: "MOTORIZED" },
    kind: "flat", amount: { value: 160 },
  },
  {
    org_id: orgId, product_id: product.id, label: "Smart Hub",
    matcher: { fieldKey: "smartHub", truthy: true },
    kind: "flat", amount: { value: 185 },
  },
]);

// Size limits (anchor: cordless 19–96" wide).
await db.from("size_constraints").insert([
  { org_id: orgId, product_id: product.id, matcher: { fieldKey: "control", valueToken: "CORDLESS" }, dimension: "width", min_value: 19, max_value: 96 },
  { org_id: orgId, product_id: product.id, matcher: { fieldKey: "control", valueToken: "MOTORIZED" }, dimension: "width", min_value: 18, max_value: 120 },
]);

// Dealer at factor 0.35 for the roller line (anchor woven-wood factor).
const { data: dealer } = await db
  .from("dealer_accounts")
  .insert({ org_id: orgId, name: "Best Blinds Dealer Co. (demo)", contact: { email: "dealer@example.com" } })
  .select("id")
  .single();
await db.from("account_factors").insert({
  org_id: orgId, dealer_account_id: dealer.id, line_key: "roller_shade", factor: 0.35,
});
console.log(`dealer: Best Blinds Dealer Co. (id ${dealer.id}, roller factor 0.35)`);

console.log("demo seed done");
