import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only, read-only Supabase client for the *blind-bot* project (the source of the
 * retailer `clients` table). Backs the admin "Sync clients" button only.
 *
 * Unlike `admin()` (the quoting DB, required to run), the source link is optional — returns
 * `null` when `BLINDBOT_SUPABASE_URL` / `BLINDBOT_SUPABASE_SERVICE_KEY` are unset, so the
 * sync route can fail with a clear "not configured" message instead of crashing.
 */
let _src: SupabaseClient | null = null;

export function blindbotSource(): SupabaseClient | null {
  if (_src) return _src;
  const url = process.env.BLINDBOT_SUPABASE_URL;
  const key = process.env.BLINDBOT_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  _src = createSupabaseClient(url, key, { auth: { persistSession: false } });
  return _src;
}
