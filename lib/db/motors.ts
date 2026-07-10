import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import { loadCatalog } from "./accessory-catalog";
import { getVariationItemModelMap } from "./variations";
import { isAccessoryConfig, type AccessoryConfig } from "@/lib/types";

// Motor inventory + per-retailer pricing (admin-managed; see 0004_motor_inventory_pricing.sql).
// Reads are best-effort: if the tables aren't present yet (migration not run) they fall back
// to "untracked / static catalog price", so the catalog never 500s on a missing migration.

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
  const lines = items.filter((i) => isAccessoryConfig(i.config as never));
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

/** model_id → default price (rows with retailer_id NULL). */
export async function getDefaultPriceMap(sb: SupabaseClient = admin()): Promise<Record<string, number>> {
  const { data, error } = await sb.from("accessory_prices").select("model_id, price").is("retailer_id", null);
  if (error) return {};
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as { model_id: string; price: number }[]) map[r.model_id] = Number(r.price);
  return map;
}

/**
 * sku → shared Default-tier price (default tier ?? static catalog price) — the same number the
 * Motor Management "Default tier" screen shows. Keyed by sku because quote/invoice accessory lines
 * snapshot only the sku (not the model id). Used as the struck-through "List" price on invoices.
 */
export async function getAccessoryDefaultPriceBySku(
  sb: SupabaseClient = admin()
): Promise<Record<string, number>> {
  const cat = await loadCatalog();
  const def = await getDefaultPriceMap(sb);
  const out: Record<string, number> = {};
  for (const m of cat.models) out[m.sku] = def[m.id] ?? m.price ?? 0;
  return out;
}

/** model_id → a single retailer's override price. */
export async function getRetailerOverrideMap(
  retailerId: string,
  sb: SupabaseClient = admin()
): Promise<Record<string, number>> {
  const { data, error } = await sb.from("accessory_prices").select("model_id, price").eq("retailer_id", retailerId);
  if (error) return {};
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as { model_id: string; price: number }[]) map[r.model_id] = Number(r.price);
  return map;
}

/** Effective price for every orderable motor for a retailer: override ?? default ?? static. */
export async function getEffectivePrices(
  retailerId: string | null,
  sb: SupabaseClient = admin()
): Promise<Record<string, number>> {
  const cat = await loadCatalog();
  const def = await getDefaultPriceMap(sb);
  const override = retailerId ? await getRetailerOverrideMap(retailerId, sb) : {};
  const out: Record<string, number> = {};
  for (const c of cat.categories.filter((x) => x.orderable)) {
    for (const m of cat.modelsIn(c.id)) out[m.id] = override[m.id] ?? def[m.id] ?? m.price ?? 0;
  }
  return out;
}

/** Effective price for one motor for one retailer (override ?? default ?? static). */
export async function resolveMotorPrice(
  modelId: string,
  retailerId: string | null,
  sb: SupabaseClient = admin()
): Promise<number> {
  if (retailerId) {
    const { data } = await sb
      .from("accessory_prices")
      .select("price")
      .eq("model_id", modelId)
      .eq("retailer_id", retailerId)
      .maybeSingle();
    if (data) return Number((data as { price: number }).price);
  }
  const { data: def } = await sb
    .from("accessory_prices")
    .select("price")
    .eq("model_id", modelId)
    .is("retailer_id", null)
    .maybeSingle();
  if (def) return Number((def as { price: number }).price);
  const cat = await loadCatalog();
  return cat.model(modelId)?.price ?? 0;
}

// Manual update-or-insert (partial unique indexes can't be PostgREST upsert targets).
async function setPrice(
  modelId: string,
  retailerId: string | null,
  price: number,
  sb: SupabaseClient
): Promise<void> {
  const sel = sb.from("accessory_prices").select("model_id").eq("model_id", modelId);
  const { data } = await (retailerId === null ? sel.is("retailer_id", null) : sel.eq("retailer_id", retailerId)).maybeSingle();
  if (data) {
    const upd = sb.from("accessory_prices").update({ price, updated_at: new Date().toISOString() }).eq("model_id", modelId);
    const { error } = await (retailerId === null ? upd.is("retailer_id", null) : upd.eq("retailer_id", retailerId));
    if (error) throw error;
  } else {
    const { error } = await sb.from("accessory_prices").insert({ model_id: modelId, retailer_id: retailerId, price });
    if (error) throw error;
  }
}

/** Set the default price for a model (retailer_id NULL). */
export async function setDefaultPrice(modelId: string, price: number, sb: SupabaseClient = admin()): Promise<void> {
  await setPrice(modelId, null, price, sb);
}

/** Set a single retailer's override price for a model. */
export async function setRetailerPrice(
  modelId: string,
  retailerId: string,
  price: number,
  sb: SupabaseClient = admin()
): Promise<void> {
  await setPrice(modelId, retailerId, price, sb);
}

/**
 * Set many prices at once — default tier (retailerId null) or one retailer's overrides.
 * Used by the admin "Save all" action so a row of edits is one request, not one per model.
 */
export async function setPricesBatch(
  retailerId: string | null,
  prices: { modelId: string; price: number }[],
  sb: SupabaseClient = admin()
): Promise<void> {
  for (const { modelId, price } of prices) {
    await setPrice(modelId, retailerId, price, sb);
  }
}

/** Reset a retailer to default for one model (delete the override) or all models. */
export async function resetRetailerPrice(
  retailerId: string,
  modelId: string | null,
  sb: SupabaseClient = admin()
): Promise<void> {
  let q = sb.from("accessory_prices").delete().eq("retailer_id", retailerId);
  if (modelId) q = q.eq("model_id", modelId);
  const { error } = await q;
  if (error) throw error;
}
