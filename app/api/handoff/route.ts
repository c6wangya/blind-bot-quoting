import { NextResponse } from "next/server";
import { verifyHandoffToken } from "@/lib/auth/blindbot-handoff";
import { createClient } from "@/lib/supabase/server";
import { publicOrigin } from "@/lib/site-url";

// Quote owns the catalog: map blind-bot's QuoteLine to the default product line page.
const QUOTE_DEFAULT_PRODUCT: Record<string, string> = {
  "roller-shade": "rs-roller-shade",
  drapery: "dp-standard-drapery",
};

/**
 * Inbound "Get a quote" from blind-bot. Quote is a SEPARATE service with its own accounts,
 * so we never silently sign anyone in. blind-bot POSTs the carried design plus a signed
 * handoff token (when handoff is enabled) that carries the blind-bot user's email. We use
 * it to decide where to land:
 *
 *  - no quote session            → /login (carrying the design) — pick how to continue
 *  - signed in, SAME email        → straight through to the configurator
 *  - signed in, DIFFERENT email   → account chooser (continue as current, or switch)
 *  - no/invalid token             → /login (can't compare identities)
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const line = String(form.get("line") ?? "");
  const img = String(form.get("img") ?? "");
  const cfg = String(form.get("cfg") ?? "");

  const product = QUOTE_DEFAULT_PRODUCT[line] ?? "rs-roller-shade";
  const params = new URLSearchParams();
  if (img) params.set("img", img);
  if (cfg) params.set("cfg", cfg);
  if (line) params.set("line", line);
  const dest = `/configure/${product}?${params.toString()}`;
  const origin = publicOrigin(req);
  const to = (path: string) => NextResponse.redirect(`${origin}${path}`, { status: 303 });
  const loginDest = `/login?next=${encodeURIComponent(dest)}`;

  const blindbotEmail = token ? verifyHandoffToken(token) : null;

  const supabase = await createClient();
  const sessionEmail = supabase ? (await supabase.auth.getUser()).data.user?.email ?? null : null;

  // Not signed in (or can't compare): land on quote's own login, carrying the design.
  if (!sessionEmail || !blindbotEmail) return to(loginDest);

  // Same person on both services → straight through.
  if (sessionEmail.toLowerCase() === blindbotEmail.toLowerCase()) return to(dest);

  // Different account signed in to quote than the one coming from blind-bot → let the user choose.
  return to(`/handoff/choose?next=${encodeURIComponent(dest)}&token=${encodeURIComponent(token)}`);
}
