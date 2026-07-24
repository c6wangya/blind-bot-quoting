#!/usr/bin/env node
// Seed product_templates from data/templates/: merges each render3d-<line>.json export with
// the matching commercial-extensions.json entry (importOverrides.excludeFields removed,
// commercial fields + sections appended, dimensions attached), then upserts one published
// template per line. Also seeds the default org if none exists.
//
// Idempotent: re-running with unchanged inputs updates the same (line_key, revision) row;
// pass --bump to publish a new revision instead (products keep their pinned revision).
//
// Usage: node scripts/seed-window-templates.mjs [--bump] [--org "Org Name"]
// Env:   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local (same as db-admin.mjs)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE env");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const bump = process.argv.includes("--bump");
const orgName = process.argv.includes("--org")
  ? process.argv[process.argv.indexOf("--org") + 1]
  : "Default Manufacturer";

const templatesDir = resolve(root, "data/templates");
const extensions = JSON.parse(readFileSync(resolve(templatesDir, "commercial-extensions.json"), "utf8"));

// Subcategory keys (blind-bot global_subcategories.key) → render3d line names.
// The extensions file is keyed by subcategory key; render3dLine overrides where they differ.
const lineEntries = Object.entries(extensions).filter(([k]) => !k.startsWith("$"));

/** Resolve {"$ref": "roller_shade.motorBrand"} entries against other lines' field lists. */
function resolveRefs(fields, allExtensions) {
  return fields.map((f) => {
    if (!f.$ref) return f;
    const [line, key] = f.$ref.split(".");
    const target = (allExtensions[line]?.fields ?? []).find((x) => x.key === key);
    if (!target) throw new Error(`Unresolvable $ref: ${f.$ref}`);
    return target;
  });
}

function stripComments(obj) {
  if (Array.isArray(obj)) return obj.map(stripComments);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) if (!k.startsWith("$")) out[k] = stripComments(v);
    return out;
  }
  return obj;
}

async function ensureOrg() {
  const { data, error } = await db.from("orgs").select("id").order("id").limit(1).maybeSingle();
  if (error) throw error;
  if (data) return data.id;
  const ins = await db.from("orgs").insert({ name: orgName, kind: "manufacturer" }).select("id").single();
  if (ins.error) throw ins.error;
  console.log(`org seeded: "${orgName}" (id ${ins.data.id})`);
  return ins.data.id;
}

async function seedLine(lineKey, ext) {
  const render3dLine = ext.render3dLine ?? lineKey;
  const exportFile = resolve(templatesDir, `render3d-${render3dLine}.json`);
  const exported = JSON.parse(readFileSync(exportFile, "utf8"));

  const exclude = new Set(ext.importOverrides?.excludeFields ?? []);
  const threeDFields = exported.variations
    .filter((v) => !exclude.has(v.key))
    .map((v) => ({ ...v, origin: "3d" }));
  const commercialFields = stripComments(resolveRefs(ext.fields ?? [], extensions));
  const fields = [...threeDFields, ...commercialFields];
  const sections = [...exported.sections, ...stripComments(ext.sections ?? [])];

  const source = {
    package: "@blindbot/render3d",
    engineVersion: exported.engineVersion,
    schemaVersion: exported.schemaVersion,
    exportedAt: exported.exportedAt,
  };

  // Current highest revision for the line.
  const { data: existing, error } = await db
    .from("product_templates")
    .select("id, revision")
    .eq("line_key", lineKey)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const row = {
    line_key: lineKey,
    label: exported.label ?? lineKey,
    status: "published",
    source,
    fields,
    sections,
    dimensions: stripComments(ext.dimensions ?? []),
    rules: exported.rules ?? [],
    updated_at: new Date().toISOString(),
  };

  if (existing && !bump) {
    const upd = await db.from("product_templates").update(row).eq("id", existing.id);
    if (upd.error) throw upd.error;
    console.log(`${lineKey}: updated rev ${existing.revision} (${fields.length} fields)`);
  } else {
    const revision = (existing?.revision ?? 0) + 1;
    const ins = await db.from("product_templates").insert({ ...row, revision });
    if (ins.error) throw ins.error;
    console.log(`${lineKey}: published rev ${revision} (${fields.length} fields)`);
  }
}

await ensureOrg();
for (const [lineKey, ext] of lineEntries) {
  await seedLine(lineKey, ext);
}
console.log("done");
