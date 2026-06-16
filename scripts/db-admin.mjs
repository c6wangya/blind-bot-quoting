// One-off DB admin for the quote Supabase project. Loads .env.local, then:
//   node scripts/db-admin.mjs inspect   — counts + product ids referenced + owner breakdown
//   node scripts/db-admin.mjs reseed    — wipe demo+seed tables so lib/db.ts reseeds fresh
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const cmd = process.argv[2] ?? "inspect";

async function inspect() {
  for (const t of ["pricing_versions", "quotes", "quote_items", "orders", "order_events"]) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t}: ${error ? "ERR " + error.message : count}`);
  }
  const { data: items } = await sb.from("quote_items").select("product_id");
  const ids = [...new Set((items ?? []).map((r) => r.product_id))];
  console.log("  product_ids referenced:", ids);
  const { data: q } = await sb.from("quotes").select("owner_id");
  const owned = (q ?? []).filter((r) => r.owner_id).length;
  console.log(`  quotes: ${owned} owned (real users) / ${(q ?? []).length - owned} demo (null owner)`);
}

async function reseed() {
  // order matters for FKs: events → orders → items → quotes → pricing
  for (const t of ["order_events", "orders", "quote_items", "quotes", "pricing_versions"]) {
    const { error } = await sb.from(t).delete().neq("id", 0);
    console.log(`  cleared ${t}: ${error ? "ERR " + error.message : "ok"}`);
  }
  console.log("done — lib/db.ts will reseed on next request");
}

await (cmd === "reseed" ? reseed() : inspect());
