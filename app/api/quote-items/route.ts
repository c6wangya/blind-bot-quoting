import { NextResponse } from "next/server";
import { getCurrentUserId, userClient } from "@/lib/auth/user";
import {
  addAccessoryItem,
  addQuoteItem,
  getActivePricing,
  getLine,
  getOrCreateDraftQuote,
  getProduct,
  removeQuoteItem,
} from "@/lib/db";
import { getAccessoryCategory, getAccessoryModel } from "@/lib/accessories-data";
import { computeQuote, PricingError } from "@/lib/pricing";
import type { ItemConfig } from "@/lib/types";

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const body = (await req.json()) as { productId: string; config?: ItemConfig; qty: number };
    const qty = Math.max(1, Math.min(500, Math.round(body.qty || 1)));
    const sb = await userClient();

    // Accessory (e.g. A-OK motor): fixed price, no configuration. Only orderable categories.
    const accessory = getAccessoryModel(body.productId);
    if (accessory) {
      const category = getAccessoryCategory(accessory.categoryId);
      if (!category?.orderable) {
        return NextResponse.json({ error: "This accessory isn't available to order" }, { status: 422 });
      }
      const quote = await getOrCreateDraftQuote(userId, undefined, sb);
      const item = await addAccessoryItem(quote.id, accessory, qty, sb);
      return NextResponse.json({ quoteId: quote.id, quoteRef: quote.ref, item });
    }

    // Full product (roller shade / drapery): server re-prices the configuration.
    const product = getProduct(body.productId);
    if (!product || !body.config) return NextResponse.json({ error: "Unknown product" }, { status: 404 });
    const line = getLine(product.lineId)!;
    const pricing = await getActivePricing(product.lineId);
    // Recompute server-side — the client preview is never trusted for stored prices.
    const computation = computeQuote(line, product, body.config, pricing.config, pricing.version);
    const quote = await getOrCreateDraftQuote(userId, undefined, sb);
    const item = await addQuoteItem(quote.id, product, body.config, qty, computation, sb);
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
  await removeQuoteItem(itemId, await userClient());
  return NextResponse.json({ ok: true });
}
