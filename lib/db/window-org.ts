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

// ---------------------------------------------------------------------------
// Org settings (jsonb) — the dealer-rollout switch lives here.
// ---------------------------------------------------------------------------

export type OrgSettings = {
  /** When true, dealer users (profiles with a dealer_account_id) see the Window Catalog and can
   *  price/order window products at their account factor. Default OFF — retailers notice nothing. */
  dealerWindowAccess?: boolean;
};

export async function getOrgSettings(client: SupabaseClient = admin()): Promise<OrgSettings> {
  const orgId = await getDefaultOrgId(client);
  const { data, error } = await client.from("orgs").select("settings").eq("id", orgId).single();
  if (error) throw error;
  return ((data as { settings: OrgSettings }).settings ?? {}) as OrgSettings;
}

export async function setOrgSetting<K extends keyof OrgSettings>(
  key: K,
  value: OrgSettings[K],
  client: SupabaseClient = admin()
): Promise<OrgSettings> {
  const orgId = await getDefaultOrgId(client);
  const settings = { ...(await getOrgSettings(client)), [key]: value };
  const { error } = await client.from("orgs").update({ settings }).eq("id", orgId);
  if (error) throw error;
  return settings;
}

/**
 * Window-catalog access for a non-admin user: their dealer account id when the org has opened
 * the dealer surface AND their profile belongs to a dealer account; null otherwise. THE gate
 * used by dealer pages and the dealer paths of price/quote APIs — the account id always comes
 * from the profile, never from a request body.
 */
export async function windowDealerAccessFor(userId: string): Promise<number | null> {
  const dealerAccountId = await getDealerAccountId(userId);
  if (dealerAccountId == null) return null;
  const settings = await getOrgSettings();
  return settings.dealerWindowAccess === true ? dealerAccountId : null;
}

/** All retailer users with their dealer-account link — the assignment surface for admins. */
export async function listDealerUsers(): Promise<
  { id: string; email: string; company: string | null; dealerAccountId: number | null }[]
> {
  const { data, error } = await admin()
    .from("profiles")
    .select("id, email, company, dealerAccountId:dealer_account_id")
    .eq("role", "retailer")
    .order("email");
  if (error) throw error;
  return (data ?? []) as never;
}

/** Link (or unlink with null) a retailer profile to a dealer account. */
export async function assignUserToDealerAccount(userId: string, dealerAccountId: number | null): Promise<void> {
  const { error } = await admin().from("profiles").update({ dealer_account_id: dealerAccountId }).eq("id", userId);
  if (error) throw error;
}
