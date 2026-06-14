import { createClient } from "@/lib/supabase/server";

/**
 * Ensure the signed-in user has a profile row, and (once) try to link it to a
 * blind-bot account by matching email. Safe to call repeatedly.
 *
 * Phase-1 linking only records that a match EXISTS (blindbot_linked_at + email);
 * it does NOT persist the blind-bot api_key (see spec D5 — avoid spreading creds).
 * A linking failure (blind-bot unreachable / no match) never blocks login.
 */
export async function ensureProfileLinked(): Promise<void> {
  const supabase = await createClient();
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from("profiles")
    .select("id, blindbot_linked_at")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    await supabase.from("profiles").insert({
      id: user.id,
      email: user.email ?? "",
      full_name: (user.user_metadata?.full_name as string | undefined) ?? null,
    });
  }

  // Try the email-based link once (until it succeeds).
  if (!existing?.blindbot_linked_at && user.email) {
    const linked = await blindbotHasAccount(user.email);
    if (linked) {
      await supabase
        .from("profiles")
        .update({
          blindbot_linked_at: new Date().toISOString(),
          blindbot_email: user.email,
        })
        .eq("id", user.id);
    }
  }
}

/** Returns true if blind-bot has a client account for this email. */
async function blindbotHasAccount(email: string): Promise<boolean> {
  const base = process.env.BLINDBOT_API_URL;
  if (!base) return false;
  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/lookup-api-key?email=${encodeURIComponent(email)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { apiKey?: string } | null;
    return !!data?.apiKey;
  } catch {
    return false; // blind-bot unreachable — don't block login
  }
}
