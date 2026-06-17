import { NextResponse } from "next/server";
import { getCurrentUserId, userClient } from "@/lib/auth/user";
import {
  addAccessoryItem,
  addQuoteItem,
  getActivePricing,
  getLine,
  getOrCreateDraftQuote,
  getProduct,
  getQuote,
  removeQuoteItem,
} from "@/lib/db";
import { getAccessoryCategory, getAccessoryModel } from "@/lib/accessories-data";
import { computeQuote, PricingError } from "@/lib/pricing";
import type { ItemConfig, QuoteRow } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The draft quote an item should land in. With an explicit `quoteId` (adding from a quote's
 * "Add Product", or replaying a pending item into a just-created quote) we target that quote
 * after checking it's the user's and still a draft; otherwise fall back to the active draft.
 */
async function resolveTargetQuote(
  userId: string,
  sb: SupabaseClient,
  quoteId: number | undefined
): Promise<Pick<QuoteRow, "id" | "ref">> {
  if (quoteId != null) {
    const q = await getQuote(quoteId, sb); // RLS-scoped — only the user's own (or admin)
    if (!q) throw new PickError("Quote not found", 404);
    if (q.status !== "draft") throw new PickError("This quote is no longer editable", 409);
    return { id: q.id, ref: q.ref };
  }
  return getOrCreateDraftQuote(userId, undefined, sb);
}

class PickError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const body = (await req.json()) as { productId: string; config?: ItemConfig; qty: number; quoteId?: number };
    const qty = Math.max(1, Math.min(500, Math.round(body.qty || 1)));
    const quoteId = typeof body.quoteId === "number" && Number.isInteger(body.quoteId) ? body.quoteId : undefined;
    const sb = await userClient();

    // Accessory (e.g. A-OK motor): fixed price, no configuration. Only orderable categories.
    const accessory = getAccessoryModel(body.productId);
    if (accessory) {
      const category = getAccessoryCategory(accessory.categoryId);
      if (!category?.orderable) {
        return NextResponse.json({ error: "This accessory isn't available to order" }, { status: 422 });
      }
      const quote = await resolveTargetQuote(userId, sb, quoteId);
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
    const quote = await resolveTargetQuote(userId, sb, quoteId);
    const item = await addQuoteItem(quote.id, product, body.config, qty, computation, sb);
    return NextResponse.json({ quoteId: quote.id, quoteRef: quote.ref, item });
  } catch (err) {
    if (err instanceof PickError) return NextResponse.json({ error: err.message }, { status: err.status });
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
