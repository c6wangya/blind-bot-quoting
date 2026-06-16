import { NextResponse } from "next/server";
import { completeBlindbotHandoff } from "@/lib/auth/blindbot-handoff";

/**
 * Reverse "Continue with BlindBot" callback (login-initiated SSO). blind-bot's
 * /authorize-quote consent page mints a narrow signed handoff token and redirects the
 * browser here with it. We verify + provision + mint a quote session (same as the inbound
 * POST /api/handoff), then continue to `next`. Invalid/expired token → manual login.
 *
 * Token arrives via query because this is a top-level browser redirect; it is consumed
 * immediately (this 303s, never renders), and the signed token only carries an email + a
 * 5-minute expiry.
 */
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const token = searchParams.get("token") ?? "";
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const ok = token ? await completeBlindbotHandoff(token) : false;
  if (ok) return NextResponse.redirect(`${origin}${next}`, 303);
  return NextResponse.redirect(
    `${origin}/login?error=handoff&next=${encodeURIComponent(next)}`,
    303
  );
}
