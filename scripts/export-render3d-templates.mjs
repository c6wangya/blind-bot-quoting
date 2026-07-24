#!/usr/bin/env node
// One-shot export of blind-bot render3d global variation schemas into data/templates/.
// These JSON files seed the window-product templates (L1) — see
// docs/superpowers/specs/2026-07-24-window-coverings-erp-v1-design.md §5.
//
// The @blindbot/render3d package is private and not a dependency of this repo;
// we load it from a sibling blind-bot-server checkout (or RENDER3D_PATH override).
// Re-run manually when blind-bot bumps its schemas, and commit the diff.
//
// Usage: node scripts/export-render3d-templates.mjs [--lines roller_shade,zebra_shade,...]

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const render3dPath =
  process.env.RENDER3D_PATH ??
  resolve(repoRoot, '../blind-bot-server/node_modules/@blindbot/render3d');

// Load past the package "exports" map (we require from outside the package).
const require_ = createRequire(import.meta.url);
const render3d = require_(resolve(render3dPath, 'dist/variations/index.js'));

const { listVariationSchemas, getVariationSchema, serializeVariationSchema, ENGINE_VERSION } = render3d;

const requested = process.argv.includes('--lines')
  ? process.argv[process.argv.indexOf('--lines') + 1].split(',')
  : listVariationSchemas().map((s) => (typeof s === 'string' ? s : s.productLine));

const outDir = resolve(repoRoot, 'data/templates');
mkdirSync(outDir, { recursive: true });

for (const line of requested) {
  const schema = getVariationSchema(line);
  const wire = serializeVariationSchema ? serializeVariationSchema(schema) : schema;
  // Strip pipeline-computed fields — never merchant-curated (spec §5, blind-bot parity).
  const variations = (wire.variations ?? []).filter((v) => !v.system);
  const out = {
    exportedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION ?? wire.engine,
    productLine: wire.productLine,
    label: wire.label,
    schemaVersion: wire.schemaVersion,
    sections: wire.sections ?? [],
    defaults: wire.defaults ?? {},
    rules: wire.rules ?? [],
    variations,
  };
  const file = resolve(outDir, `render3d-${line}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`${line}: ${variations.length} fields -> ${file}`);
}
