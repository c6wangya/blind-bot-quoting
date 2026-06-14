import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for browser/client components. Returns null when Supabase env
 * is not configured (auth disabled) so the app runs without `.env.local`.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
