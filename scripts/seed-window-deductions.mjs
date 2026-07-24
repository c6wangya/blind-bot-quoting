#!/usr/bin/env node
// Seed manufacturing deduction tables for roller/zebra shades. Offsets transcribed from the
// anchor factory's Roller/Zebra MO Master Form "Deductions" sheets (2025-12 revision):
//   cassettes:  valance −3/8 IM / −1/4 OM · tube −1.25 / −1.125 · fabric W −1.25 / −1.125 ·
//               fabric L +12 (wrap allowance) · pocket hem bar −1.625 / −1.5
//   fascia:     valance −1/8 / 0 · tube −1.25 / −1.375 · pocket hem bar −1.625 / −1.75
//   open roll:  tube −1.25 / −1.125 (no valance component)
//   zebra:      same architecture; fabric L = 2×drop + 12 (doubled loop) → offset over height
//               handled as base:height with the doubling noted for Phase B2 (formula support).
// These are STARTING values for the demo org — the whole point of the table is that the
// factory tunes them in the admin UI.
//
// Usage: node scripts/seed-window-deductions.mjs

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

const { data: org } = await db.from("orgs").select("id").order("id").limit(1).single();
const orgId = org.id;

const reset = process.argv.includes("--reset");
const { count } = await db
  .from("deduction_tables")
  .select("*", { count: "exact", head: true })
  .eq("org_id", orgId);
if ((count ?? 0) > 0 && !reset) {
  console.log(`deduction tables already seeded (${count} rows) — pass --reset to replace`);
  process.exit(0);
}
if (reset && (count ?? 0) > 0) {
  await db.from("deduction_tables").delete().eq("org_id", orgId);
  console.log(`--reset: removed ${count} existing rows`);
}

const CASSETTES = ["CASSETTE_SQUARE", "CASSETTE_ROUND"];
const FASCIAS = ["FASCIA", "ROUND_FASCIA"];

const comp = (offset, base, label, multiplier) => ({ offset, base, label, ...(multiplier ? { multiplier } : {}) });

// Anchor hardware rules: brackets step by width (≤60 → 2, ≤96 → 3, wider → 4); screws = 2×brackets.
const PARTS = [
  { key: "bracket", label: "Brackets", qtyRule: { kind: "width_band", breaks: [60, 96, 999], values: [2, 3, 4] } },
  { key: "screw", label: "Screws", qtyRule: { kind: "width_band", breaks: [60, 96, 999], values: [4, 6, 8] } },
];

const rows = [];
let order = 0;
for (const lineKey of ["roller_shade", "banded_shade"]) {
  // Roller fabric length = drop + 12″ wrap; zebra = 2×drop + 12 (banded fabric is a doubled loop).
  const fabricLenMult = lineKey === "banded_shade" ? 2 : undefined;
  const fabricLenOffset = 12;
  for (const [mount, valOff, tubeOff, fabWOff, railOff] of [
    ["INSIDE", -0.375, -1.25, -1.25, -1.625],
    ["OUTSIDE", -0.25, -1.125, -1.125, -1.5],
  ]) {
    rows.push({
      org_id: orgId, line_key: lineKey, sort_order: order++,
      label: `Cassette · ${mount === "INSIDE" ? "Inside" : "Outside"} Mount`,
      matcher: [
        { fieldKey: "mount", valueToken: mount },
        { fieldKey: "topTreatment", anyOf: CASSETTES },
      ],
      components: {
        valance: comp(valOff, "width", "Cassette / Valance"),
        tube: comp(tubeOff, "width", "Tube"),
        fabricWidth: comp(fabWOff, "width", "Fabric Width"),
        fabricLength: comp(fabricLenOffset, "height", "Fabric Length", fabricLenMult),
        bottomRail: comp(railOff, "width", "Bottom Rail (Pocket Hem)"),
      },
      parts: PARTS,
      note: "Anchor MO form, cassette family",
    });
  }
  for (const [mount, valOff, tubeOff, railOff] of [
    ["INSIDE", -0.125, -1.25, -1.625],
    ["OUTSIDE", 0, -1.375, -1.75],
  ]) {
    rows.push({
      org_id: orgId, line_key: lineKey, sort_order: order++,
      label: `Fascia · ${mount === "INSIDE" ? "Inside" : "Outside"} Mount`,
      matcher: [
        { fieldKey: "mount", valueToken: mount },
        { fieldKey: "topTreatment", anyOf: FASCIAS },
      ],
      components: {
        valance: comp(valOff, "width", "Fascia"),
        tube: comp(tubeOff, "width", "Tube"),
        fabricWidth: comp(tubeOff, "width", "Fabric Width"),
        fabricLength: comp(fabricLenOffset, "height", "Fabric Length", fabricLenMult),
        bottomRail: comp(railOff, "width", "Bottom Rail (Pocket Hem)"),
      },
      parts: PARTS,
      note: "Anchor MO form, fascia family",
    });
  }
  for (const [mount, tubeOff] of [
    ["INSIDE", -1.25],
    ["OUTSIDE", -1.125],
  ]) {
    rows.push({
      org_id: orgId, line_key: lineKey, sort_order: order++,
      label: `Open / Hidden Roll · ${mount === "INSIDE" ? "Inside" : "Outside"} Mount`,
      matcher: [
        { fieldKey: "mount", valueToken: mount },
        { fieldKey: "topTreatment", anyOf: ["OPEN_ROLL", "HIDDEN_ROLL", "VALANCE"] },
      ],
      components: {
        tube: comp(tubeOff, "width", "Tube"),
        fabricWidth: comp(tubeOff, "width", "Fabric Width"),
        fabricLength: comp(fabricLenOffset, "height", "Fabric Length", fabricLenMult),
        bottomRail: comp(tubeOff - 0.375, "width", "Bottom Rail"),
      },
      parts: PARTS,
      note: "Anchor MO form, no-cassette family",
    });
  }
}

const { error } = await db.from("deduction_tables").insert(rows);
if (error) throw error;
console.log(`seeded ${rows.length} deduction rows (roller_shade + banded_shade)`);
