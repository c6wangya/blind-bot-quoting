import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import { loadCatalog } from "./accessory-catalog";
import { getVariationItemModelMap } from "./variations";
import { accessoryListKey, isAccessoryConfig, type AccessoryConfig } from "@/lib/types";

// Motor inventory + per-retailer pricing (admin-managed; see 0004_motor_inventory_pricing.sql).
// Reads are best-effort: if the tables aren't present yet (migration not run) they fall back
// to "untracked / static catalog price", so the catalog never 500s on a missing migration.

// created_at maps so admin lists can order by creation time (earliest first). Timestamps are
// ISO strings — lexicographic compare == chronological. Missing rows sort last (empty string→"").
export async function getCatalogCreatedAt(
  sb: SupabaseClient = admin()
): Promise<{ brands: Record<string, string>; models: Record<string, string> }> {
  const [b, m] = await Promise.all([
    sb.from("accessory_brands").select("id, created_at"),
    sb.from("accessory_models").select("id, created_at"),
  ]);
  const brands: Record<string, string> = {};
  for (const r of (b.data ?? []) as { id: string; created_at: string }[]) brands[r.id] = r.created_at ?? "";
  const models: Record<string, string> = {};
  for (const r of (m.data ?? []) as { id: string; created_at: string }[]) models[r.id] = r.created_at ?? "";
  return { brands, models };
}

// ---------------- inventory ----------------

/** model_id → stock. A model with no row is untracked (unlimited) and absent from the map. */
export async function getInventoryMap(sb: SupabaseClient = admin()): Promise<Record<string, number>> {
  const { data, error } = await sb.from("accessory_inventory").select("model_id, stock");
  if (error) return {};
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as { model_id: string; stock: number }[]) map[r.model_id] = r.stock;
  return map;
}

/** A single model's stock, or null if untracked (unlimited). */
export async function getStock(modelId: string, sb: SupabaseClient = admin()): Promise<number | null> {
  const { data, error } = await sb.from("accessory_inventory").select("stock").eq("model_id", modelId).maybeSingle();
  if (error || !data) return null;
  return (data as { stock: number }).stock;
}

export async function setStock(modelId: string, stock: number, sb: SupabaseClient = admin()): Promise<void> {
  const s = Math.max(0, Math.round(stock));
  const { error } = await sb
    .from("accessory_inventory")
    .upsert({ model_id: modelId, stock: s, updated_at: new Date().toISOString() }, { onConflict: "model_id" });
  if (error) throw error;
}

/** Clear a model's stock tracking (back to unlimited). */
export async function clearStock(modelId: string, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("accessory_inventory").delete().eq("model_id", modelId);
  if (error) throw error;
}

/**
 * Set/clear many models' stock at once (stock null = clear to untracked). Used by the admin
 * "Save all" action so a screen of edits is one request, not one per model.
 */
export async function setStockBatch(
  entries: { modelId: string; stock: number | null }[],
  sb: SupabaseClient = admin()
): Promise<void> {
  for (const { modelId, stock } of entries) {
    if (stock === null) await clearStock(modelId, sb);
    else await setStock(modelId, stock, sb);
  }
}

// Reserve/restore stock are concurrency-safe Postgres functions (migration 0036): the whole batch
// runs inside one transaction with row locks, so it never oversells, never false-fails on a value
// that merely changed, never loses a concurrent restore, and is all-or-nothing across models.

/**
 * Reservable stock needs for a quote's accessory lines, aggregated per model. Each accessory line
 * reserves (a) its own motor model — qty = line qty — AND (b) every chosen variation sub-part's
 * *source model* — qty = line qty × per-motor sub-part qty (THE-772). The variation sub-parts are
 * the "配件" shown with their own stock in the catalog (a variation item's stock is its source
 * model's inventory); they MUST be deducted too, not just the parent motor. Variation items with no
 * source model, and any untracked model, aren't stock-backed and are skipped downstream by
 * reserve/restore. Aggregating per model also collapses a model that appears as both a motor line
 * and a sub-part into one need. Async because the variation item→model map is a DB read.
 */
export async function motorNeedsOf(
  items: { config: unknown; productId: string; qty: number }[],
  sb: SupabaseClient = admin()
): Promise<{ modelId: string; qty: number }[]> {
  // Air-freight lines are procured from China and never touch US inventory, so they're excluded
  // from every reserve/restore path (this single filter feeds submit, cancel, and refund).
  const lines = items.filter(
    (i) => isAccessoryConfig(i.config as never) && !(i.config as AccessoryConfig).airFreight
  );
  if (lines.length === 0) return [];
  const itemModelMap = await getVariationItemModelMap(sb);
  const byModel: Record<string, number> = {};
  for (const line of lines) {
    byModel[line.productId] = (byModel[line.productId] ?? 0) + line.qty;
    const cfg = line.config as AccessoryConfig;
    for (const v of cfg.variations ?? []) {
      const src = itemModelMap[v.itemId];
      if (!src) continue; // sub-part not synced from a stock-tracked catalog model
      byModel[src] = (byModel[src] ?? 0) + line.qty * (v.qty ?? 1);
    }
  }
  return Object.entries(byModel).map(([modelId, qty]) => ({ modelId, qty }));
}

/** Add reserved stock back (inverse of deductMotorStock) — used when an order is cancelled. */
export async function restoreMotorStock(
  needs: { modelId: string; qty: number }[],
  sb: SupabaseClient = admin()
): Promise<void> {
  if (needs.length === 0) return;
  const { error } = await sb.rpc("restore_motor_stock", {
    p_needs: needs.map((n) => ({ model_id: n.modelId, qty: n.qty })),
  });
  if (error) throw error;
}

/**
 * Deduct stock for the motor lines of a submitted pre-order. Untracked models are skipped.
 * If any tracked model is short, nothing is deducted (atomic in the DB function) and it throws a
 * message naming the short models.
 */
export async function deductMotorStock(
  needs: { modelId: string; qty: number }[],
  sb: SupabaseClient = admin()
): Promise<void> {
  if (needs.length === 0) return;
  const { data, error } = await sb.rpc("reserve_motor_stock", {
    p_needs: needs.map((n) => ({ model_id: n.modelId, qty: n.qty })),
  });
  if (error) throw error;
  // [] on success; otherwise the short models (nothing was deducted).
  const short = (data ?? []) as { model_id: string; left: number; need: number }[];
  if (short.length > 0) {
    const cat = await loadCatalog();
    const names = short
      .map((s) => `${cat.model(s.model_id)?.name ?? s.model_id} (only ${s.left} left, need ${s.need})`)
      .join("; ");
    throw new Error(`Insufficient motor stock: ${names}`);
  }
}

// ---------------- per-retailer pricing ----------------

/** model_id → shared-tier price (rows with retailer_id NULL) for the given tier. */
async function getSharedPriceMap(
  tier: "default" | "business",
  sb: SupabaseClient = admin()
): Promise<Record<string, number>> {
  const { data, error } = await sb
    .from("accessory_prices")
    .select("model_id, price")
    .is("retailer_id", null)
    .eq("tier", tier);
  if (error) return {};
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as { model_id: string; price: number }[]) map[r.model_id] = Number(r.price);
  return map;
}

/** model_id → shared Business-tier price (retailer_id NULL, tier='business'). */
export async function getBusinessPriceMap(sb: SupabaseClient = admin()): Promise<Record<string, number>> {
  return getSharedPriceMap("business", sb);
}

/**
 * The Default (retail) catalog price for accessory lines — the struck-through "List" price on
 * invoices. Returned as TWO lookups because sku is NOT unique (the A-OK / B-OK brand catalogs reuse
 * skus): `byId` keyed by model id (the robust match for lines that snapshot their modelId) and
 * `byKey` keyed by brand+category+sku (the fallback for legacy lines that only snapshot the sku).
 * Always the Default tier, regardless of any Business-tier authorization.
 */
export async function getAccessoryDefaultPrices(): Promise<{
  byId: Record<string, number>;
  byKey: Record<string, number>;
}> {
  const cat = await loadCatalog();
  const byId: Record<string, number> = {};
  const byKey: Record<string, number> = {};
  for (const m of cat.models) {
    const price = m.price ?? 0;
    byId[m.id] = price;
    const category = cat.category(m.categoryId);
    const brand = cat.brands.find((b) => b.id === category?.brandId)?.name ?? cat.brand.name;
    byKey[accessoryListKey(brand, category?.name ?? m.categoryId, m.sku)] = price;
  }
  return { byId, byKey };
}

/** model_id → a single retailer's price rows for one tier ('default' = its overrides). */
async function getRetailerTierMap(
  retailerId: string,
  tier: "default" | "business",
  sb: SupabaseClient = admin()
): Promise<Record<string, number>> {
  const { data, error } = await sb
    .from("accessory_prices")
    .select("model_id, price")
    .eq("retailer_id", retailerId)
    .eq("tier", tier);
  if (error) return {};
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as { model_id: string; price: number }[]) map[r.model_id] = Number(r.price);
  return map;
}

/** model_id → a single retailer's override price (per-retailer rows, tier='default'). */
export async function getRetailerOverrideMap(
  retailerId: string,
  sb: SupabaseClient = admin()
): Promise<Record<string, number>> {
  return getRetailerTierMap(retailerId, "default", sb);
}

/** model_id → a single retailer's personal Business-tier price (per-retailer rows, tier='business'). */
export async function getRetailerBusinessMap(
  retailerId: string,
  sb: SupabaseClient = admin()
): Promise<Record<string, number>> {
  return getRetailerTierMap(retailerId, "business", sb);
}

/**
 * Effective price for every orderable motor for a retailer. Resolution chain:
 *   per-retailer override  ??  per-retailer personal Business price  ??  Default  ??  static
 * Personal Business prices are set per-product by the admin (the "Personal business" button on the
 * retailer pricing screen syncs one product to the shared Business tier); they apply on their own,
 * without any account-wide authorization flag.
 */
export async function getEffectivePrices(
  retailerId: string | null,
  sb: SupabaseClient = admin()
): Promise<Record<string, number>> {
  const cat = await loadCatalog();
  const override = retailerId ? await getRetailerOverrideMap(retailerId, sb) : {};
  const out: Record<string, number> = {};
  for (const c of cat.categories.filter((x) => x.orderable)) {
    for (const m of cat.modelsIn(c.id))
      out[m.id] = override[m.id] ?? m.price ?? 0;
  }
  return out;
}

/**
 * Effective price for one motor for one retailer — the trusted server-side re-price:
 *   per-retailer override (This retailer / synced Business)  ??  Default (default_price)
 */
export async function resolveMotorPrice(
  modelId: string,
  retailerId: string | null,
  sb: SupabaseClient = admin()
): Promise<number> {
  if (retailerId) {
    // The per-retailer override (tier='default') — set directly, or synced to the Business price.
    const { data } = await sb
      .from("accessory_prices")
      .select("price")
      .eq("model_id", modelId)
      .eq("retailer_id", retailerId)
      .eq("tier", "default")
      .maybeSingle();
    if (data) return Number((data as { price: number }).price);
  }
  // Default price is the catalog base price (accessory_models.default_price).
  const cat = await loadCatalog();
  return cat.model(modelId)?.price ?? 0;
}

// Manual update-or-insert (partial unique indexes can't be PostgREST upsert targets).
// `tier` distinguishes the two rows a given (model, retailer-or-shared) can hold: the Default tier
// and the Business tier (shared Business, or a retailer's personal Business price).
async function setPrice(
  modelId: string,
  retailerId: string | null,
  price: number,
  sb: SupabaseClient,
  tier: "default" | "business" = "default"
): Promise<void> {
  const updated_at = new Date().toISOString();
  if (retailerId === null && tier === "default") {
    // The shared Default price IS the catalog base price — a single source of truth backing both
    // the Catalog tab and the Pricing → Default screen. Write it to accessory_models.default_price
    // (there is no shared retailer_id-NULL/tier='default' row in accessory_prices anymore).
    const { error } = await sb.from("accessory_models").update({ default_price: price }).eq("id", modelId);
    if (error) throw error;
    return;
  }
  if (retailerId === null) {
    // Shared row keyed by (model_id, tier) among the retailer_id-NULL rows.
    const { data } = await sb
      .from("accessory_prices")
      .select("model_id")
      .eq("model_id", modelId)
      .is("retailer_id", null)
      .eq("tier", tier)
      .maybeSingle();
    if (data) {
      const { error } = await sb
        .from("accessory_prices")
        .update({ price, updated_at })
        .eq("model_id", modelId)
        .is("retailer_id", null)
        .eq("tier", tier);
      if (error) throw error;
    } else {
      const { error } = await sb.from("accessory_prices").insert({ model_id: modelId, retailer_id: null, price, tier });
      if (error) throw error;
    }
    return;
  }
  // Per-retailer row keyed by (model_id, retailer_id, tier): tier='default' = an override,
  // tier='business' = this retailer's personal Business price.
  const { data } = await sb
    .from("accessory_prices")
    .select("model_id")
    .eq("model_id", modelId)
    .eq("retailer_id", retailerId)
    .eq("tier", tier)
    .maybeSingle();
  if (data) {
    const { error } = await sb
      .from("accessory_prices")
      .update({ price, updated_at })
      .eq("model_id", modelId)
      .eq("retailer_id", retailerId)
      .eq("tier", tier);
    if (error) throw error;
  } else {
    const { error } = await sb
      .from("accessory_prices")
      .insert({ model_id: modelId, retailer_id: retailerId, price, tier });
    if (error) throw error;
  }
}

/** Set the default price for a model (shared, retailer_id NULL, Default tier). */
export async function setDefaultPrice(modelId: string, price: number, sb: SupabaseClient = admin()): Promise<void> {
  await setPrice(modelId, null, price, sb, "default");
}

/** Set the shared Business-tier price for a model (retailer_id NULL, tier='business'). */
export async function setBusinessPrice(modelId: string, price: number, sb: SupabaseClient = admin()): Promise<void> {
  await setPrice(modelId, null, price, sb, "business");
}

/**
 * model_id → internal purchase/cost price (accessory_models.cost_price). Admin-only — never shown to
 * customers and never part of the effective-price chain. NULL cost is omitted (treated as "not set").
 */
export async function getCostPriceMap(sb: SupabaseClient = admin()): Promise<Record<string, number>> {
  const { data, error } = await sb.from("accessory_models").select("id, cost_price");
  if (error) return {};
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as { id: string; cost_price: number | null }[])
    if (r.cost_price != null) map[r.id] = Number(r.cost_price);
  return map;
}

/** Set a model's internal purchase/cost price (accessory_models.cost_price). Admin-only. */
export async function setCostPrice(modelId: string, price: number, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("accessory_models").update({ cost_price: price }).eq("id", modelId);
  if (error) throw error;
}

/** Batch-set internal cost prices ("Save all" on the Cost price screen). Admin-only. */
export async function setCostPricesBatch(
  prices: { modelId: string; price: number }[],
  sb: SupabaseClient = admin()
): Promise<void> {
  for (const { modelId, price } of prices) await setCostPrice(modelId, price, sb);
}

/** Set a single retailer's price for a model — its override (default tier) or personal Business price. */
export async function setRetailerPrice(
  modelId: string,
  retailerId: string,
  price: number,
  sb: SupabaseClient = admin(),
  tier: "default" | "business" = "default"
): Promise<void> {
  await setPrice(modelId, retailerId, price, sb, tier);
}

/**
 * Set many prices at once — a shared tier (retailerId null: Default or Business) or one retailer's
 * overrides. Used by the admin "Save all" action so a row of edits is one request, not one per model.
 */
export async function setPricesBatch(
  retailerId: string | null,
  prices: { modelId: string; price: number }[],
  sb: SupabaseClient = admin(),
  tier: "default" | "business" = "default"
): Promise<void> {
  for (const { modelId, price } of prices) {
    await setPrice(modelId, retailerId, price, sb, tier);
  }
}

/**
 * Reset a retailer's custom pricing for one model or all models. `tier` narrows it to just the
 * override ('default') or just the personal Business price ('business'); omit to clear both.
 */
export async function resetRetailerPrice(
  retailerId: string,
  modelId: string | null,
  sb: SupabaseClient = admin(),
  tier?: "default" | "business"
): Promise<void> {
  let q = sb.from("accessory_prices").delete().eq("retailer_id", retailerId);
  if (modelId) q = q.eq("model_id", modelId);
  if (tier) q = q.eq("tier", tier);
  const { error } = await q;
  if (error) throw error;
}
