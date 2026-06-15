import type { EmailOtpType } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { blindbotAuth } from "@/lib/supabase/blindbot";
import { ensureProfileLinked } from "@/lib/auth/profile";

/**
 * Validate a blind-bot access_token, provision/link a quote account for that email, and
 * establish a quote session (cookies). Returns true on success; false means the caller
 * should fall back to manual login. Never throws.
 */
export async function completeBlindbotHandoff(token: string): Promise<boolean> {
  try {
    const bb = blindbotAuth();
    if (!bb) return false;

    const {
      data: { user },
      error,
    } = await bb.auth.getUser(token);
    if (error || !user?.email) return false;
    const email = user.email;

    // Provision (idempotent — an existing email simply errors and is ignored).
    await admin().auth.admin.createUser({ email, email_confirm: true });

    // Mint a quote session without a password: generate a magiclink token, then verify it
    // on the cookie-writing server client (same mechanism as the OAuth callback).
    const { data: link, error: linkErr } = await admin().auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkErr || !link?.properties?.hashed_token) return false;

    const supabase = await createServerClient();
    if (!supabase) return false;
    const { error: otpErr } = await supabase.auth.verifyOtp({
      type: (link.properties.verification_type ?? "magiclink") as EmailOtpType,
      token_hash: link.properties.hashed_token,
    });
    if (otpErr) return false;

    await ensureProfileLinked();
    return true;
  } catch {
    return false;
  }
}
