import { NextResponse } from "next/server";
import { completeBlindbotHandoff } from "@/lib/auth/blindbot-handoff";

// Quote owns the catalog: map blind-bot's QuoteLine to the default product line page.
const QUOTE_DEFAULT_PRODUCT: Record<string, string> = {
  "roller-shade": "rs-roller-shade",
  drapery: "dp-standard-drapery",
};

/**
 * Verified "Continue with BlindBot" handoff. blind-bot POSTs the retailer's blind-bot
 * access_token plus the carried design (line/img/cfg). We validate + provision + mint a
 * quote session, then 303-redirect into the configurator. An invalid token degrades to
 * manual login (preserving the import via ?next=).
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const line = String(form.get("line") ?? "");
  const img = String(form.get("img") ?? "");
  const cfg = String(form.get("cfg") ?? "");

  const product = QUOTE_DEFAULT_PRODUCT[line] ?? "rs-aria";
  const params = new URLSearchParams();
  if (img) params.set("img", img);
  if (cfg) params.set("cfg", cfg);
  if (line) params.set("line", line);
  const dest = `/configure/${product}?${params.toString()}`;
  const origin = new URL(req.url).origin;

  const ok = token ? await completeBlindbotHandoff(token) : false;
  // 303: turn the POST into a GET of the destination, carrying the freshly-set cookies.
  if (ok) return NextResponse.redirect(`${origin}${dest}`, { status: 303 });
  return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(dest)}`, { status: 303 });
}
