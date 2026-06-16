import { admin } from "@/lib/supabase/admin";

/** The signed-in retailer's profile fields used for the account display. */
export async function getProfile(
  userId: string
): Promise<{ email: string; company: string | null; role: "retailer" | "admin" } | null> {
  const { data, error } = await admin()
    .from("profiles")
    .select("email, company, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    // The `role` column is added by an out-of-band migration; until it lands, fall back
    // to reading the always-present columns and treat everyone as a retailer.
    const { data: d2, error: e2 } = await admin()
      .from("profiles")
      .select("email, company")
      .eq("id", userId)
      .maybeSingle();
    if (e2) throw e2;
    if (!d2) return null;
    const r = d2 as { email: string; company: string | null };
    return { email: r.email, company: r.company, role: "retailer" };
  }
  if (!data) return null;
  const row = data as { email: string; company: string | null; role: string | null };
  return { email: row.email, company: row.company, role: row.role === "admin" ? "admin" : "retailer" };
}
