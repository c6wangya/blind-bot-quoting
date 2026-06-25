// One-off: pre-fill per-motor shipping rates (ship_ground / ship_expedite) per the THE-772 rules.
//   node scripts/seed-shipping-rates.mjs        — apply
//   node scripts/seed-shipping-rates.mjs --dry  — preview only
//
// Rules (USD/unit):
//   AM25 → ground 1.25 / expedite 4      AM35 → 4 / 18      AM45 → 6 / 22
//   Crown / Drive parts → 0 / 0 (excluded)
//   everything else (other motors) → 1.5 / 1.5
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const dry = process.argv.includes("--dry");

function rateFor(name, sku, catName) {
  const c = (catName || "").toLowerCase();
  if (c.includes("crown") || c.includes("drive")) return { ground: 0, expedite: 0 };
  const m = (name || "").match(/AM\s?(\d+)/i) || (sku || "").match(/AM\s?(\d+)/i);
  const fam = m ? Number(m[1]) : null;
  if (fam === 25) return { ground: 1.25, expedite: 4 };
  if (fam === 35) return { ground: 4, expedite: 18 };
  if (fam === 45) return { ground: 6, expedite: 22 };
  return { ground: 1.5, expedite: 1.5 };
}

async function main() {
  const { data: cats, error: ce } = await sb.from("accessory_categories").select("id, name");
  if (ce) throw ce;
  const catName = Object.fromEntries((cats ?? []).map((c) => [c.id, c.name]));

  const { data: mods, error: me } = await sb
    .from("accessory_models")
    .select("id, name, sku, category_id")
    .order("sort");
  if (me) throw me;

  let n = 0;
  for (const m of mods ?? []) {
    const r = rateFor(m.name, m.sku, catName[m.category_id]);
    console.log(`  ${m.name.padEnd(38)} ${(catName[m.category_id] || "").padEnd(22)} → ground $${r.ground}  expedite $${r.expedite}`);
    if (!dry) {
      const { error } = await sb
        .from("accessory_models")
        .update({ ship_ground: r.ground, ship_expedite: r.expedite })
        .eq("id", m.id);
      if (error) throw error;
    }
    n++;
  }
  console.log(`\n${dry ? "[dry-run] would update" : "updated"} ${n} models.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
