import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";

// v1 runs single-org: one manufacturer (the anchor factory) seeded by scripts/seed-window-templates.mjs.
// Every window-ERP call site resolves the org through here so the multi-org upgrade is a
// signature change in one file, not a hunt through the codebase.

let cachedOrgId: number | null = null;

export async function getDefaultOrgId(client: SupabaseClient = admin()): Promise<number> {
  if (cachedOrgId != null) return cachedOrgId;
  const { data, error } = await client.from("orgs").select("id").order("id").limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("No org seeded — run scripts/seed-window-templates.mjs");
  cachedOrgId = (data as { id: number }).id;
  return cachedOrgId;
}

/** The dealer account of the signed-in user, or null (admins/staff have none). */
export async function getDealerAccountId(userId: string): Promise<number | null> {
  const { data, error } = await admin()
    .from("profiles")
    .select("dealer_account_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as { dealer_account_id: number | null } | null)?.dealer_account_id ?? null;
}
