import { NextResponse } from "next/server";
import { getCurrentUserId, userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import {
  addAccessoryItem,
  addAdjustmentLine,
  addQuoteItem,
  applyPriceOverride,
  getActivePricing,
  getLine,
  getInventoryMap,
  getOrCreateDraftQuote,
  getProduct,
  getQuote,
  getQuoteOwnerId,
  getStock,
  getVariationItemModelMap,
  loadCatalog,
  removeQuoteItem,
  resolveMotorPrice,
  resolveVariationSelections,
  setLinePriceOverride,
  updateAccessoryItem,
  updateQuoteItem,
} from "@/lib/db";
import { computeQuote, PricingError } from "@/lib/pricing";
import { isAccessoryConfig, type AccessoryConfig, type ItemConfig, type QuoteComputation, type QuoteRow, type VariationSnapshot } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const round2 = (n: number) => Math.round(n * 100) / 100;

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

// ---- Merge-on-add: a second "Add" of an identical item bumps the existing line's qty instead of
// splitting into a duplicate row. Only merges when EVERYTHING matches (same product/model, same
// variation selection, same computed unit price, and no per-quote price override), so per-line
// custom pricing is never silently collapsed. Applies to new adds only — pre-existing dupes stay.

type QuoteLineRow = {
  id: number;
  product_id: string;
  config: ItemConfig | AccessoryConfig;
  qty: number;
  computation: QuoteComputation;
};

/** Existing lines on the target quote. */
async function loadQuoteLines(quoteId: number, sb: SupabaseClient): Promise<QuoteLineRow[]> {
  const { data } = await sb
    .from("quote_items")
    .select("id, product_id, config, qty, computation")
    .eq("quote_id", quoteId);
  return (data ?? []) as QuoteLineRow[];
}

/** Order-independent structural key (jsonb round-trips don't preserve object key order). */
function stableKey(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableKey).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableKey(o[k])}`).join(",")}}`;
}

/** Same variation selection (same sub-parts + per-motor qtys), order-independent. */
function sameVariations(a: VariationSnapshot[] = [], b: VariationSnapshot[] = []): boolean {
  if (a.length !== b.length) return false;
  const key = (vs: VariationSnapshot[]) => vs.map((v) => `${v.itemId}:${v.qty ?? 1}`).sort();
  const [ak, bk] = [key(a), key(b)];
  return ak.every((k, i) => k === bk[i]);
}

class PickError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Each add-on part carries stock (via its source model). Per motor unit it needs `v.qty`, so a line
 * of `qty` motors needs `qty × v.qty`. Returns a friendly error message if any part is short, else
 * null. Untracked parts (no inventory row) are unlimited.
 */
async function checkSubPartStock(
  variations: Array<{ itemId: string; itemLabel: string; qty: number }>,
  qty: number
): Promise<string | null> {
  if (!variations.length) return null;
  const [itemModelMap, inv] = await Promise.all([getVariationItemModelMap(), getInventoryMap()]);
  for (const v of variations) {
    const modelId = itemModelMap[v.itemId];
    const partStock = modelId ? inv[modelId] : undefined;
    if (partStock === undefined) continue; // untracked
    const need = qty * v.qty;
    if (need > partStock) {
      return partStock === 0
        ? `${v.itemLabel} is out of stock`
        : `Only ${partStock} of ${v.itemLabel} in stock (you need ${need})`;
    }
  }
  return null;
}

type ComponentPrices = NonNullable<QuoteComputation["componentPrices"]>;

/**
 * Merge an admin's (partial) per-component price change into a line's existing overrides.
 * `change === null` clears everything; a number sets, an explicit null clears that one component.
 * Sub-part overrides for parts no longer on the line are dropped. Returns undefined when nothing
 * remains overridden (→ the line falls back to standard prices).
 */
function mergeComponentPrices(
  existing: QuoteComputation["componentPrices"],
  change: { motor?: number | null; items?: Record<string, number | null> } | null | undefined,
  selectedIds: Set<string>,
  by: string
): ComponentPrices | undefined {
  const clean = (n: number) => Math.max(0, Math.round(n * 100) / 100);
  if (change === null) return undefined;
  let motor = existing?.motor;
  const items: Record<string, number> = { ...(existing?.items ?? {}) };
  if (change) {
    if ("motor" in change) motor = change.motor == null ? undefined : clean(Number(change.motor));
    for (const [id, val] of Object.entries(change.items ?? {})) {
      if (val == null) delete items[id];
      else items[id] = clean(Number(val));
    }
  }
  // Drop overrides for sub-parts that are no longer on the line.
  for (const id of Object.keys(items)) if (!selectedIds.has(id)) delete items[id];
  const hasItems = Object.keys(items).length > 0;
  if (motor === undefined && !hasItems) return undefined;
  return { ...(motor !== undefined ? { motor } : {}), ...(hasItems ? { items } : {}), by, at: new Date().toISOString() };
}

export async function POST(req: Request) {
  try {
    // While acting on behalf of a retailer (代下单), items land in THAT retailer's draft and are
    // priced with their overrides; service_role is needed so an implicit new draft can be created
    // with the retailer as owner (RLS `quotes_insert` blocks a JWT client from doing so).
    const acting = await getActingContext();
    if (!acting.realUid) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const userId = acting.actingAsId ?? acting.realUid;
    const body = (await req.json()) as {
      productId: string;
      config?: ItemConfig;
      qty: number;
      quoteId?: number;
      /** Legacy: chosen variation item ids (qty 1 each). */
      variationItemIds?: string[];
      /** Per-sub-part selection with a per-motor quantity (THE-772). */
      variationItems?: Array<{ itemId: string; qty?: number }>;
      /** Admin-only ad-hoc money line: surcharge (positive) or discount (negative). */
      adjustment?: { label: string; amount: number; note?: string };
    };
    const qty = Math.max(1, Math.min(500, Math.round(body.qty || 1)));
    const quoteId = typeof body.quoteId === "number" && Number.isInteger(body.quoteId) ? body.quoteId : undefined;
    const sb = acting.actingAsId ? admin() : await userClient();

    // Admin-only ad-hoc surcharge/discount line — not a catalog product (no stock, no manufacturing).
    if (body.adjustment) {
      if (!acting.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
      const label = body.adjustment.label?.trim();
      const amount = Number(body.adjustment.amount);
      if (!label) return NextResponse.json({ error: "A label is required" }, { status: 400 });
      if (!Number.isFinite(amount) || amount === 0) {
        return NextResponse.json({ error: "Enter a non-zero amount" }, { status: 400 });
      }
      const quote = await resolveTargetQuote(userId, sb, quoteId);
      const note = body.adjustment.note?.trim() || undefined;
      const item = await addAdjustmentLine(quote.id, label, amount, note, sb);
      return NextResponse.json({ quoteId: quote.id, quoteRef: quote.ref, item });
    }

    const catalog = await loadCatalog();

    // Accessory (e.g. A-OK motor): fixed price, no configuration. Only orderable categories.
    const accessory = catalog.model(body.productId);
    if (accessory) {
      const category = catalog.category(accessory.categoryId);
      if (!category?.orderable) {
        return NextResponse.json({ error: "This accessory isn't available to order" }, { status: 422 });
      }
      // Stock cap (tracked models only) — friendly block before it ever reaches submit.
      const stock = await getStock(accessory.id);
      if (stock !== null && qty > stock) {
        return NextResponse.json(
          { error: stock === 0 ? "This motor is out of stock" : `Only ${stock} of this motor left` },
          { status: 409 }
        );
      }
      // Minimum order quantity — the client clamps the stepper, but never trust it.
      const moq = accessory.moq ?? 0;
      if (moq > 0 && qty < moq) {
        return NextResponse.json({ error: `Minimum order for this motor is ${moq}` }, { status: 409 });
      }
      // Resolve the chosen variation items (validates availability + pairing; snapshots labels/prices).
      const requested = Array.isArray(body.variationItems)
        ? body.variationItems
        : Array.isArray(body.variationItemIds)
          ? body.variationItemIds.map((itemId) => ({ itemId, qty: 1 }))
          : [];
      const variations = await resolveVariationSelections(accessory.id, requested, sb);
      const stockErr = await checkSubPartStock(variations, qty);
      if (stockErr) return NextResponse.json({ error: stockErr }, { status: 409 });
      const quote = await resolveTargetQuote(userId, sb, quoteId);
      // Snapshot this retailer's effective price (override → default → static).
      const unitPrice = await resolveMotorPrice(accessory.id, userId);
      const newUnit = round2(unitPrice + variations.reduce((s, v) => s + v.price * (v.qty ?? 1), 0));
      // Merge into an identical existing line (same model + variations + price, no per-quote override).
      const dup = (await loadQuoteLines(quote.id, sb)).find(
        (l) =>
          l.product_id === accessory.id &&
          isAccessoryConfig(l.config) &&
          sameVariations((l.config as AccessoryConfig).variations, variations) &&
          l.computation.componentPrices == null &&
          l.computation.priceOverride == null &&
          round2(l.computation.unitPrice) === newUnit,
      );
      if (dup) {
        const mergedQty = dup.qty + qty;
        if (stock !== null && mergedQty > stock) {
          return NextResponse.json(
            { error: stock === 0 ? "This motor is out of stock" : `Only ${stock} of this motor left` },
            { status: 409 },
          );
        }
        const mergedSubErr = await checkSubPartStock(variations, mergedQty);
        if (mergedSubErr) return NextResponse.json({ error: mergedSubErr }, { status: 409 });
        await updateAccessoryItem(dup.id, accessory, mergedQty, unitPrice, variations, sb);
        return NextResponse.json({ quoteId: quote.id, quoteRef: quote.ref, item: { id: dup.id, merged: true } });
      }
      const item = await addAccessoryItem(quote.id, accessory, qty, sb, unitPrice, variations);
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
    // Merge into an identical existing product line (same product + config + price, no override).
    const dup = (await loadQuoteLines(quote.id, sb)).find(
      (l) =>
        l.product_id === product.id &&
        !isAccessoryConfig(l.config) &&
        l.computation.priceOverride == null &&
        stableKey(l.config) === stableKey(body.config) &&
        round2(l.computation.unitPrice) === round2(computation.unitPrice),
    );
    if (dup) {
      await updateQuoteItem(dup.id, { qty: Math.min(500, dup.qty + qty) }, sb);
      return NextResponse.json({ quoteId: quote.id, quoteRef: quote.ref, item: { id: dup.id, merged: true } });
    }
    const item = await addQuoteItem(quote.id, product, body.config, qty, computation, sb);
    return NextResponse.json({ quoteId: quote.id, quoteRef: quote.ref, item });
  } catch (err) {
    if (err instanceof PickError) return NextResponse.json({ error: err.message }, { status: err.status });
    const status = err instanceof PricingError ? 422 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

/**
 * Update a line: a product re-config (`{itemId, productId, config, qty?}` → re-priced
 * server-side) or just a quantity change (`{itemId, qty}`, used by the line qty stepper).
 */
export async function PATCH(req: Request) {
  try {
    // Acting-as aware (代下单): an admin editing a retailer's draft uses service_role so RLS doesn't
    // block the write; a retailer editing their own uses their JWT client so RLS still guards it.
    const acting = await getActingContext();
    if (!acting.realUid) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const body = (await req.json()) as {
      itemId: number;
      productId?: string;
      config?: ItemConfig;
      qty?: number;
      /** Per-sub-part selection with a per-motor quantity (accessory lines only). */
      variationItems?: Array<{ itemId: string; qty?: number }>;
      /** Admin-only per-quote price override: a flat unit price, or null to clear it (product lines). */
      unitPriceOverride?: number | null;
      /**
       * Admin-only per-quote component price override (accessory lines): a partial map merged into the
       * line's existing overrides — `motor`/each `items[id]` may be a number to set or null to clear;
       * the whole value being null clears all component overrides.
       */
      componentPrices?: { motor?: number | null; items?: Record<string, number | null> } | null;
    };
    const itemId = Number(body.itemId);
    if (!Number.isInteger(itemId)) return NextResponse.json({ error: "Bad item id" }, { status: 400 });
    const sb = acting.actingAsId ? admin() : await userClient();

    // Admin-only per-quote price override (set a flat unit price, or null to clear → standard price).
    if (body.unitPriceOverride !== undefined) {
      if (!acting.isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
      let value: number | null = null;
      if (body.unitPriceOverride !== null) {
        value = Number(body.unitPriceOverride);
        if (!Number.isFinite(value) || value < 0) {
          return NextResponse.json({ error: "Enter a price of 0 or more" }, { status: 400 });
        }
      }
      await setLinePriceOverride(itemId, value, acting.realUid, sb);
      return NextResponse.json({ ok: true });
    }

    // Load the line — the select doubles as the ownership guard (RLS-scoped via sb).
    const { data: existing, error: exErr } = await sb
      .from("quote_items")
      .select("product_id, quote_id, config, qty, computation")
      .eq("id", itemId)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    const row = existing as {
      product_id: string;
      quote_id: number;
      config: ItemConfig | AccessoryConfig;
      qty: number;
      computation: QuoteComputation;
    };
    // A standing admin flat override (product lines) is re-applied after any re-price so a special
    // per-quote price survives a qty / re-config edit (only an admin can change or clear it).
    const keepOverride = row.computation.priceOverride
      ? { value: row.computation.priceOverride.value, by: row.computation.priceOverride.by }
      : undefined;

    // A component-price change is admin-only (accessory lines).
    if (body.componentPrices !== undefined && !acting.isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // Accessory line: re-price the motor qty and/or per-motor sub-part qtys, enforcing stock.
    const accessory = isAccessoryConfig(row.config) ? (await loadCatalog()).model(row.product_id) : null;
    if (accessory) {
      const cfg = row.config as AccessoryConfig;
      const moq = accessory.moq ?? 0;
      const qty = Math.max(Math.max(1, moq), Math.min(500, Math.round(body.qty ?? row.qty)));
      const stock = await getStock(accessory.id);
      if (stock !== null && qty > stock) {
        return NextResponse.json(
          { error: stock === 0 ? "This motor is out of stock" : `Only ${stock} of this motor left` },
          { status: 409 }
        );
      }
      // Use the body's per-part qtys when sent; otherwise keep the line's existing selection.
      const requested = Array.isArray(body.variationItems)
        ? body.variationItems
        : (cfg.variations ?? []).map((v) => ({ itemId: v.itemId, qty: v.qty ?? 1 }));
      const variations = await resolveVariationSelections(accessory.id, requested, sb);
      const stockErr = await checkSubPartStock(variations, qty);
      if (stockErr) return NextResponse.json({ error: stockErr }, { status: 409 });
      const ownerId = await getQuoteOwnerId(row.quote_id);
      const unitPrice = await resolveMotorPrice(accessory.id, ownerId ?? null);
      // Resolve the effective per-component overrides: start from the line's existing overrides, then
      // apply the (partial) change in this request (number = set, null = clear; whole value null =
      // clear all). Finally drop any sub-part override that's no longer on the line.
      const selectedIds = new Set(variations.map((v) => v.itemId));
      const componentPrices = mergeComponentPrices(
        row.computation.componentPrices,
        body.componentPrices,
        selectedIds,
        acting.realUid
      );
      await updateAccessoryItem(itemId, accessory, qty, unitPrice, variations, sb, componentPrices);
      return NextResponse.json({ ok: true });
    }

    // Full product: a re-config (re-priced server-side) or just a qty change.
    const qty = body.qty != null ? Math.max(1, Math.min(500, Math.round(body.qty))) : undefined;
    if (body.config && body.productId) {
      const product = getProduct(body.productId);
      if (!product) return NextResponse.json({ error: "Unknown product" }, { status: 404 });
      const line = getLine(product.lineId)!;
      const pricing = await getActivePricing(product.lineId);
      const std = computeQuote(line, product, body.config, pricing.config, pricing.version);
      const computation = keepOverride ? applyPriceOverride(std, keepOverride.value, keepOverride.by) : std;
      await updateQuoteItem(itemId, { config: body.config, computation, qty }, sb);
    } else {
      if (qty === undefined) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
      await updateQuoteItem(itemId, { qty }, sb);
    }
    return NextResponse.json({ ok: true });
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
