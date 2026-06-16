import { createHmac, timingSafeEqual } from "crypto";
import type { EmailOtpType } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { ensureProfileLinked } from "@/lib/auth/profile";

/**
 * Verify a blind-bot-issued handoff token of the form "<payload>.<sig>", where payload is
 * base64url(JSON {email, exp}) and sig is HMAC-SHA256(payload) keyed by the shared
 * QUOTE_HANDOFF_SECRET. Returns the email on success, or null (bad sig / expired / unset
 * secret). The raw token only carries an email + short expiry — it can't act on blind-bot.
 */
export function verifyHandoffToken(token: string): string | null {
  const secret = process.env.QUOTE_HANDOFF_SECRET;
  if (!secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let data: { email?: unknown; exp?: unknown };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data.email !== "string" || !data.email) return null;
  if (typeof data.exp !== "number" || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data.email;
}

/**
 * Validate a blind-bot handoff token, provision/link a quote account for that email, and
 * establish a quote session (cookies). Returns true on success; false means the caller
 * should fall back to manual login. Never throws.
 */
export async function completeBlindbotHandoff(token: string): Promise<boolean> {
  try {
    const email = verifyHandoffToken(token);
    if (!email) return false;

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

    // This flow is itself an explicit "use BlindBot here" action, so mark handoff consent —
    // future same-account handoffs then pass through silently (no repeat consent).
    await supabase.auth.updateUser({ data: { bb_handoff_consented: true } }).catch(() => {});

    await ensureProfileLinked();
    return true;
  } catch {
    return false;
  }
}
