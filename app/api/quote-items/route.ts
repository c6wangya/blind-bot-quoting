import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/user";
import {
  addQuoteItem,
  getActivePricing,
  getLine,
  getOrCreateDraftQuote,
  getProduct,
  removeQuoteItem,
} from "@/lib/db";
import { computeQuote, PricingError } from "@/lib/pricing";
import type { ItemConfig } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const body = (await req.json()) as { productId: string; config: ItemConfig; qty: number };
    const product = getProduct(body.productId);
    if (!product) return NextResponse.json({ error: "Unknown product" }, { status: 404 });
    const line = getLine(product.lineId)!;
    const pricing = await getActivePricing(product.lineId);
    const qty = Math.max(1, Math.min(500, Math.round(body.qty || 1)));
    // Recompute server-side — the client preview is never trusted for stored prices.
    const computation = computeQuote(line, product, body.config, pricing.config, pricing.version);
    const quote = await getOrCreateDraftQuote(userId);
    const item = await addQuoteItem(quote.id, product, body.config, qty, computation);
    return NextResponse.json({ quoteId: quote.id, quoteRef: quote.ref, item });
  } catch (err) {
    const status = err instanceof PricingError ? 422 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

export async function DELETE(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { itemId } = (await req.json()) as { itemId: number };
  await removeQuoteItem(itemId);
  return NextResponse.json({ ok: true });
}
