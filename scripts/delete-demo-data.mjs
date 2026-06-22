// Delete the seeded demo quotes/orders (owner_id IS NULL) — real retailer data always has an
// owner, so this targets only the old public sample data.
//   node scripts/delete-demo-data.mjs          # dry-run: report what would be deleted
//   node scripts/delete-demo-data.mjs --fix      # delete
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
  const { data: quotes } = await sb.from("quotes").select("id, ref").is("owner_id", null);
  const quoteIds = (quotes ?? []).map((q) => q.id);
  if (quoteIds.length === 0) {
    console.log("No owner-less demo quotes found. Nothing to delete.");
    return;
  }
  const { data: orders } = await sb.from("orders").select("id, ref").in("quote_id", quoteIds);
  const orderIds = (orders ?? []).map((o) => o.id);

  console.log(`Demo quotes (owner_id IS NULL): ${(quotes ?? []).map((q) => q.ref).join(", ")}`);
  console.log(`Their orders: ${(orders ?? []).map((o) => o.ref).join(", ") || "(none)"}`);

  if (!FIX) {
    console.log("\nDry run. Re-run with --fix to delete these quotes + their items/orders/events.");
    return;
  }

  if (orderIds.length) {
    await sb.from("order_events").delete().in("order_id", orderIds);
    await sb.from("orders").delete().in("id", orderIds);
  }
  await sb.from("quote_items").delete().in("quote_id", quoteIds);
  const { error } = await sb.from("quotes").delete().in("id", quoteIds);
  if (error) throw error;
  console.log(`\nDeleted ${quoteIds.length} demo quote(s) + ${orderIds.length} order(s) and their items/events. ✅`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
