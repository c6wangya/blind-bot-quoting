import { NextResponse } from "next/server";

// Quote owns the catalog: map blind-bot's QuoteLine to the default product line page.
const QUOTE_DEFAULT_PRODUCT: Record<string, string> = {
  "roller-shade": "rs-roller-shade",
  drapery: "dp-standard-drapery",
};

/**
 * Inbound "Get a quote" from blind-bot. Quote is a SEPARATE service, so we do NOT silently
 * create a quote session here. Instead the user lands on quote's own /login (carrying the
 * design via ?next=) and explicitly chooses how to continue — Continue with Google or
 * Continue with BlindBot. The BlindBot choice then completes the verified handoff via the
 * authorize page → /api/handoff/callback.
 *
 * If the visitor already has a quote session, /login forwards straight through to the
 * configurator, so returning users stay seamless; only signed-out users see the choice.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const line = String(form.get("line") ?? "");
  const img = String(form.get("img") ?? "");
  const cfg = String(form.get("cfg") ?? "");

  const product = QUOTE_DEFAULT_PRODUCT[line] ?? "rs-roller-shade";
  const params = new URLSearchParams();
  if (img) params.set("img", img);
  if (cfg) params.set("cfg", cfg);
  if (line) params.set("line", line);
  const dest = `/configure/${product}?${params.toString()}`;
  const origin = new URL(req.url).origin;

  // 303: turn the cross-origin POST into a GET of /login, carrying the design in `next`.
  return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(dest)}`, { status: 303 });
}
