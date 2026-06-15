import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
