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

/**
 * A retailer's standing order-level discount (% off every order subtotal). 0 when unset, when the
 * account is the public demo (no owner), or when the column hasn't been migrated yet.
 */
export async function getRetailerDiscount(ownerId: string | null | undefined): Promise<number> {
  if (!ownerId) return 0;
  const { data, error } = await admin()
    .from("profiles")
    .select("order_discount_pct")
    .eq("id", ownerId)
    .maybeSingle();
  if (error || !data) return 0;
  const pct = Number((data as { order_discount_pct: number | null }).order_discount_pct ?? 0);
  return Number.isFinite(pct) && pct > 0 ? Math.min(pct, 100) : 0;
}

/** Set a retailer's order-level discount (clamped to 0–100). */
export async function setRetailerDiscount(retailerId: string, pct: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  const { error } = await admin().from("profiles").update({ order_discount_pct: clamped }).eq("id", retailerId);
  if (error) throw error;
}

/** All non-admin accounts (the retailers), for the admin pricing page. */
export async function listRetailers(): Promise<{ id: string; email: string; company: string | null }[]> {
  const { data, error } = await admin().from("profiles").select("id, email, company, role").order("email");
  if (error) {
    // role column not present yet → treat everyone as a retailer
    const { data: d2 } = await admin().from("profiles").select("id, email, company").order("email");
    return ((d2 ?? []) as { id: string; email: string; company: string | null }[]);
  }
  return ((data ?? []) as { id: string; email: string; company: string | null; role: string | null }[])
    .filter((p) => p.role !== "admin")
    .map(({ id, email, company }) => ({ id, email, company }));
}
