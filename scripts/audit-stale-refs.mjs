// Report (read-only) accessory quote lines whose product_id now points at a DIFFERENT product
// than the one that was quoted — a candidate stale reference from the old id-reuse bug
// (a deleted product's slug id reused by a same-SKU re-creation, pre the "never reuse id" fix).
//
// Signal: the live model at the line's product_id has a different sku/name than the line's
// snapshot. (Heads-up: a deliberate sku/name *rename* of the same product also shows up here —
// review by hand before doing anything. There is no auto-fix: quote lines are historical
// snapshots and the safe remedy, if ever needed, is to re-point a specific product_id by hand.)
//
//   node scripts/audit-stale-refs.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data: items, error } = await sb
    .from("quote_items")
    .select("id, quote_id, product_id, line_id, config, created_at")
    .eq("line_id", "accessory");
  if (error) throw error;

  const { data: models } = await sb.from("accessory_models").select("id, sku, name");
  const byId = new Map((models ?? []).map((m) => [m.id, m]));

  const { data: quotes } = await sb.from("quotes").select("id, ref");
  const refById = new Map((quotes ?? []).map((q) => [q.id, q.ref]));

  const mismatched = []; // live model exists but its sku/name ≠ the line snapshot
  const orphan = []; // product deleted, never recreated — harmless (no live model to flag)
  for (const it of items ?? []) {
    const model = byId.get(it.product_id);
    if (!model) {
      orphan.push(it);
    } else if (model.sku !== it.config?.sku || model.name !== it.config?.name) {
      mismatched.push({ it, model });
    }
  }

  console.log(`\nAccessory quote lines scanned: ${items?.length ?? 0}`);
  console.log(`Orphaned references (deleted product, not recreated — harmless): ${orphan.length}`);
  console.log(`Mismatched references (live product differs from snapshot — review): ${mismatched.length}\n`);

  for (const { it, model } of mismatched) {
    const ref = refById.get(it.quote_id) ?? `#${it.quote_id}`;
    console.log(
      `  • quote ${ref}  product_id="${it.product_id}"\n` +
        `      line snapshot : "${it.config?.name ?? "?"}" (sku ${it.config?.sku ?? "?"})\n` +
        `      live model now: "${model.name}" (sku ${model.sku})  ← different — stale id reuse, OR a deliberate rename`
    );
  }
  for (const it of orphan) {
    const ref = refById.get(it.quote_id) ?? `#${it.quote_id}`;
    console.log(`  (orphan) quote ${ref}  product_id="${it.product_id}"  "${it.config?.name ?? "?"}" — product deleted; harmless`);
  }

  if (mismatched.length === 0) console.log("\nNo mismatched references. Database is clean. ✅");
  else console.log("\nReview the above by hand — renames look the same as stale reuse. No changes were made.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
