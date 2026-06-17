import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import {
  getAccessoryCategories,
  getAccessoryModel,
  getAccessoryModels,
} from "@/lib/accessories-data";

// Motor inventory + per-retailer pricing (admin-managed; see 0004_motor_inventory_pricing.sql).
// Reads are best-effort: if the tables aren't present yet (migration not run) they fall back
// to "untracked / static catalog price", so the catalog never 500s on a missing migration.

/** All orderable motor model ids (the surface these features apply to). */
export function orderableMotorIds(): string[] {
  return getAccessoryCategories()
    .filter((c) => c.orderable)
    .flatMap((c) => getAccessoryModels(c.id).map((m) => m.id));
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
 * Deduct stock for the motor lines of a submitted pre-order. Untracked models are skipped.
 * If any tracked model is short (or lost a race), nothing stays deducted — already-applied
 * decrements are rolled back — and it throws a message naming the short models.
 */
export async function deductMotorStock(
  needs: { modelId: string; qty: number }[],
  sb: SupabaseClient = admin()
): Promise<void> {
  const byModel = new Map<string, number>();
  for (const n of needs) byModel.set(n.modelId, (byModel.get(n.modelId) ?? 0) + n.qty);

  const done: { modelId: string; qty: number }[] = [];
  const short: { modelId: string; left: number; need: number }[] = [];

  for (const [modelId, qty] of byModel) {
    const { data: row } = await sb.from("accessory_inventory").select("stock").eq("model_id", modelId).maybeSingle();
    if (!row) continue; // untracked → unlimited
    const stock = (row as { stock: number }).stock;
    if (stock < qty) {
      short.push({ modelId, left: stock, need: qty });
      continue;
    }
    // optimistic decrement: only succeeds if stock hasn't changed since the read
    const { data: updated, error } = await sb
      .from("accessory_inventory")
      .update({ stock: stock - qty, updated_at: new Date().toISOString() })
      .eq("model_id", modelId)
      .eq("stock", stock)
      .select("model_id");
    if (error || !updated || updated.length === 0) {
      short.push({ modelId, left: stock, need: qty });
      continue;
    }
    done.push({ modelId, qty });
  }

  if (short.length > 0) {
    for (const d of done) {
      const { data: row } = await sb.from("accessory_inventory").select("stock").eq("model_id", d.modelId).maybeSingle();
      if (row) {
        await sb
          .from("accessory_inventory")
          .update({ stock: (row as { stock: number }).stock + d.qty })
          .eq("model_id", d.modelId);
      }
    }
    const names = short
      .map((s) => `${getAccessoryModel(s.modelId)?.name ?? s.modelId} (only ${s.left} left, need ${s.need})`)
      .join("; ");
    throw new Error(`Insufficient motor stock: ${names}`);
  }
}

// ---------------- per-retailer pricing ----------------

const staticPrice = (modelId: string) => getAccessoryModel(modelId)?.price ?? 0;

/** model_id → default price (rows with retailer_id NULL). */
export async function getDefaultPriceMap(sb: SupabaseClient = admin()): Promise<Record<string, number>> {
  const { data, error } = await sb.from("accessory_prices").select("model_id, price").is("retailer_id", null);
  if (error) return {};
  const map: Record<string, number> = {};
  for (const r of (data ?? []) as { model_id: string; price: number }[]) map[r.model_id] = Number(r.price);
  return map;
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
  const def = await getDefaultPriceMap(sb);
  const override = retailerId ? await getRetailerOverrideMap(retailerId, sb) : {};
  const out: Record<string, number> = {};
  for (const id of orderableMotorIds()) out[id] = override[id] ?? def[id] ?? staticPrice(id);
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
  return staticPrice(modelId);
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
