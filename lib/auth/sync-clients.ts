import { admin } from "@/lib/supabase/admin";
import { blindbotSource } from "@/lib/supabase/blindbot";

/** Initial password for every provisioned account; user is nudged to change it on first login. */
const DEFAULT_PASSWORD = "123456Abcde";

export type SyncClientsResult = {
  /** Source clients seen (total in blind-bot). */
  total: number;
  /** Emails newly provisioned in this run. */
  created: string[];
  /** Emails already present in quoting (profiles ∪ auth) — left untouched. */
  skipped: string[];
  /** Emails that failed to provision, with the reason. */
  failed: { email: string; reason: string }[];
};

/** All existing account emails in quoting (profiles ∪ auth.users), lower-cased for matching. */
async function existingQuotingEmails(): Promise<Set<string>> {
  const seen = new Set<string>();

  const { data: profiles, error } = await admin().from("profiles").select("email");
  if (error) throw new Error(`read quoting profiles: ${error.message}`);
  for (const p of profiles ?? []) {
    const e = (p.email as string | null)?.trim().toLowerCase();
    if (e) seen.add(e);
  }

  // auth.users isn't in PostgREST — page through the GoTrue admin API.
  for (let page = 1; ; page++) {
    const { data, error: authErr } = await admin().auth.admin.listUsers({ page, perPage: 1000 });
    if (authErr) throw new Error(`list quoting auth users: ${authErr.message}`);
    for (const u of data.users) {
      const e = u.email?.trim().toLowerCase();
      if (e) seen.add(e);
    }
    if (data.users.length < 1000) break;
  }

  return seen;
}

/**
 * Provision every blind-bot `clients` retailer that doesn't yet exist in quoting:
 * creates the Supabase auth user (default password, `must_change_password` nudge) and a
 * matching `profiles` row (role `retailer`, company from `company_name`). Idempotent —
 * dedupes against profiles ∪ auth by email, so re-running only fills gaps.
 */
export async function syncBlindbotClients(): Promise<SyncClientsResult> {
  const src = blindbotSource();
  if (!src) {
    throw new Error(
      "blind-bot source DB not configured — set BLINDBOT_SUPABASE_URL and BLINDBOT_SUPABASE_SERVICE_KEY"
    );
  }

  const { data: clients, error } = await src.from("clients").select("email, company_name");
  if (error) throw new Error(`read blind-bot clients: ${error.message}`);

  const existing = await existingQuotingEmails();
  const result: SyncClientsResult = { total: clients?.length ?? 0, created: [], skipped: [], failed: [] };

  for (const c of clients ?? []) {
    const email = (c.email as string | null)?.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (existing.has(key)) {
      result.skipped.push(email);
      continue;
    }
    existing.add(key); // guard against duplicate source rows in the same run

    const company = (c.company_name as string | null)?.trim() || null;
    const { data: created, error: createErr } = await admin().auth.admin.createUser({
      email,
      password: DEFAULT_PASSWORD,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    });
    if (createErr || !created?.user) {
      result.failed.push({ email, reason: createErr?.message ?? "auth user not returned" });
      continue;
    }

    const { error: profileErr } = await admin()
      .from("profiles")
      .upsert(
        { id: created.user.id, email, full_name: company, company, role: "retailer" },
        { onConflict: "id" }
      );
    if (profileErr) {
      result.failed.push({ email, reason: `profile: ${profileErr.message}` });
      continue;
    }

    result.created.push(email);
  }

  return result;
}
