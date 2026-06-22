import { DRAPERY_PRICING_V1, ROLLER_PRICING_V1, ROLLER_PRICING_V2 } from "@/lib/catalog-data";
import { admin } from "@/lib/supabase/admin";

// Seeds the pricing versions the quote engine needs (idempotent — inserts only when empty).
// Demo quotes/orders are intentionally NOT seeded (the old samples were removed).

const DEMO_RETAILER = "Harbor & Lane Interiors"; // default retailer label on new quotes

let seedPromise: Promise<void> | null = null;
export function ensureSeeded(): Promise<void> {
  return (seedPromise ??= seed());
}

async function seed(): Promise<void> {
  const a = admin();
  const { count: pvCount } = await a.from("pricing_versions").select("*", { count: "exact", head: true });
  if (pvCount) return;
  await a.from("pricing_versions").insert([
    { line_id: "roller-shade", version: "2026.1", active: false, note: "Initial FOB grid", config: ROLLER_PRICING_V1 },
    {
      line_id: "roller-shade",
      version: "2026.2",
      active: true,
      note: "Q2 freight adjustment: motorized +$5, blackout multiplier 1.28→1.30",
      config: ROLLER_PRICING_V2,
    },
    { line_id: "drapery", version: "2026.1", active: true, note: "Initial cut-and-make formula", config: DRAPERY_PRICING_V1 },
  ]);
}

export { DEMO_RETAILER };
