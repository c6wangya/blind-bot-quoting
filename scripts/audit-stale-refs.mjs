// Audit/repair stale accessory references on quote lines.
//
// Background: before the "never reuse a model id" fix, hard-deleting a product freed its
// slug id; re-creating a same-SKU product reused it and inherited the deleted product's
// leftover quote_items — a false "in use on quote N" when deleting the new product.
//
// A quote line is a *stale* reference when the model now living at its product_id was created
// AFTER the quote line (so it cannot be the product that was actually quoted). Quote lines
// snapshot everything they display (name/price/image), so re-pointing product_id to a tombstone
// leaves the historical quote unchanged — it just stops the live product being falsely flagged.
//
//   node scripts/audit-stale-refs.mjs          # dry-run: report only
//   node scripts/audit-stale-refs.mjs --fix     # re-point stale references to a tombstone id
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const FIX = process.argv.includes("--fix");

async function main() {
  const { data: items, error } = await sb
    .from("quote_items")
    .select("id, quote_id, product_id, line_id, config, created_at")
    .eq("line_id", "accessory");
  if (error) throw error;

  const { data: models } = await sb.from("accessory_models").select("id, sku, name, created_at");
  const byId = new Map((models ?? []).map((m) => [m.id, m]));

  const { data: quotes } = await sb.from("quotes").select("id, ref");
  const refById = new Map((quotes ?? []).map((q) => [q.id, q.ref]));

  const stale = [];
  const orphan = []; // product deleted, never recreated — harmless (no live model to flag)
  for (const it of items ?? []) {
    const model = byId.get(it.product_id);
    if (!model) {
      orphan.push(it);
      continue;
    }
    if (new Date(model.created_at) > new Date(it.created_at)) {
      stale.push({ it, model });
    }
  }

  console.log(`\nAccessory quote lines scanned: ${items?.length ?? 0}`);
  console.log(`Orphaned references (deleted product, not recreated — harmless): ${orphan.length}`);
  console.log(`STALE references (live product created after the quote — false "in use"): ${stale.length}\n`);

  for (const { it, model } of stale) {
    const ref = refById.get(it.quote_id) ?? `#${it.quote_id}`;
    console.log(
      `  • quote ${ref}  product_id="${it.product_id}"\n` +
        `      line snapshot : "${it.config?.name ?? "?"}" (sku ${it.config?.sku ?? "?"}), line @ ${it.created_at}\n` +
        `      live model now: "${model.name}" (sku ${model.sku}), created @ ${model.created_at}  ← created later, so not the quoted product`
    );
  }

  if (stale.length === 0) {
    console.log("Nothing stale to clean. ✅");
    return;
  }

  if (!FIX) {
    console.log(`\nDry run. Re-run with --fix to re-point these ${stale.length} line(s) to a tombstone product_id.`);
    return;
  }

  console.log(`\nRe-pointing ${stale.length} stale line(s)…`);
  let ok = 0;
  for (const { it } of stale) {
    const tombstone = `${it.product_id}__hist__${it.id}`; // never produced by slug() or new ids
    const { error: upErr } = await sb.from("quote_items").update({ product_id: tombstone }).eq("id", it.id);
    if (upErr) console.log(`  ERR item ${it.id}: ${upErr.message}`);
    else ok++;
  }
  console.log(`Done — ${ok}/${stale.length} re-pointed. Snapshots unchanged; historical quotes display the same.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
