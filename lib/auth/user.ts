import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/db";

/**
 * The Supabase client to use for the signed-in retailer's own data: the cookie/JWT
 * client so Row-Level Security applies. Falls back to the service_role client only when
 * Supabase auth isn't configured (no session possible anyway). Pass this into the
 * `lib/db.ts` query helpers for retailer-facing reads/writes.
 */
export async function userClient(): Promise<SupabaseClient> {
  return (await createClient()) ?? admin();
}

/** The signed-in user's id (= profiles.id = quotes.owner_id), or null if not signed in. */
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Require a signed-in user; redirect to /login (returning to `next`) if absent. */
export async function requireUserId(next: string): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) redirect(`/login?next=${encodeURIComponent(next)}`);
  return id;
}

/**
 * Whether the signed-in user is still on the migration's initial password and should be nudged
 * (not forced) to change it. Backed by `auth.users.user_metadata.must_change_password`, cleared
 * when they set a new password via the Account page.
 */
export async function mustChangePassword(): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) return false;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.user_metadata?.must_change_password === true;
}

/** True if the user's profile role is admin. */
export async function isAdmin(userId: string): Promise<boolean> {
  const profile = await getProfile(userId);
  return profile?.role === "admin";
}

/** Page guard: require a signed-in admin; 404 (notFound) otherwise. Returns the user id. */
export async function requireAdminPage(next: string): Promise<string> {
  const id = await requireUserId(next);
  if (!(await isAdmin(id))) notFound();
  return id;
}

/** Whether a user may see/act on a record: own, public demo sample (null owner), or admin. */
export async function canAccessOwned(userId: string, ownerId: string | null | undefined): Promise<boolean> {
  if (ownerId === undefined) return false; // record not found
  if (ownerId === null) return true; // public demo sample
  if (ownerId === userId) return true; // own record
  return isAdmin(userId);
}
