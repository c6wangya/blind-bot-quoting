import { NextResponse } from "next/server";
import { verifyHandoffToken } from "@/lib/auth/blindbot-handoff";
import { publicOrigin } from "@/lib/site-url";

// Quote owns the catalog: map blind-bot's QuoteLine to the default product line page.
const QUOTE_DEFAULT_PRODUCT: Record<string, string> = {
  "roller-shade": "rs-roller-shade",
  drapery: "dp-standard-drapery",
};

/**
 * Inbound "Get a quote" from blind-bot — a CROSS-SITE form POST. Because it's cross-site,
 * the browser does NOT send quote's own session cookie here (SameSite=Lax), so this handler
 * cannot tell whether/who the user is signed in as. So we DON'T decide identity here:
 * verify the signed handoff token (carrying the blind-bot email) and hand off to a
 * SAME-ORIGIN GET page (/handoff/choose) which CAN read the session cookie and decide:
 *   no session → /login · same email → straight through · different email → account chooser.
 *
 * No/invalid token → /login (can't compare identities), carrying the design via ?next=.
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

  // Valid token → same-origin chooser page decides what to do (it can read the session).
  if (token && verifyHandoffToken(token)) {
    return to(`/handoff/choose?next=${encodeURIComponent(dest)}&token=${encodeURIComponent(token)}`);
  }
  // No/invalid token → quote's own login, carrying the design.
  return to(`/login?next=${encodeURIComponent(dest)}`);
}
