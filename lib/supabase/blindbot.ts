import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only client for blind-bot's AUTH Supabase project — used only to validate a
 * retailer's blind-bot access_token (`auth.getUser(token)`) during the verified handoff.
 * This is blind-bot's auth project (issues the retailer session), NOT its image-storage
 * project. Returns null when env is unset, so the handoff degrades to manual login.
 */
export function blindbotAuth(): SupabaseClient | null {
  const url = process.env.BLINDBOT_SUPABASE_URL;
  const key = process.env.BLINDBOT_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
