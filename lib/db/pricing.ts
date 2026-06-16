import { admin } from "@/lib/supabase/admin";
import type { PricingVersionRow } from "@/lib/types";
import { PRICING_COLS } from "./internal";
import { ensureSeeded } from "./seed";

export async function getActivePricing(lineId: string): Promise<PricingVersionRow> {
  await ensureSeeded();
  const { data, error } = await admin()
    .from("pricing_versions")
    .select(PRICING_COLS)
    .eq("line_id", lineId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No active pricing version for ${lineId}`);
  return data as unknown as PricingVersionRow;
}

export async function getAllPricingVersions(): Promise<PricingVersionRow[]> {
  await ensureSeeded();
  const { data, error } = await admin()
    .from("pricing_versions")
    .select(PRICING_COLS)
    .order("line_id")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PricingVersionRow[];
}
