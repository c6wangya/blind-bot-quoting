import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";

// THE-772 — product variations: admin-managed, priced, per-product options. Mirrors the tag
// system but items carry a price and are selected at quote time. Reads are public catalog
// metadata (admin() = system read); admin writes go through the API's requireAdmin gate.

export type VariationItem = { id: string; variationId: string; name: string; price: number; sort: number; image: string | null };
export type VariationType = { id: string; name: string; pairGroup: string | null; sort: number; items: VariationItem[] };
/** One chosen variation item, snapshotted onto a quote line. */
export type VariationSelection = {
  variationId: string;
  variationName: string;
  itemId: string;
  itemLabel: string;
  price: number;
};

const TYPE_COLS = "id, name, pairGroup:pair_group, sort";
const ITEM_COLS = "id, variationId:variation_id, name, price, sort, image:image_url";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function uniqueId(table: string, base: string, sb: SupabaseClient): Promise<string> {
  let id = base || "x";
  let n = 1;
  for (;;) {
    const { data } = await sb.from(table).select("id").eq("id", id).maybeSingle();
    if (!data) return id;
    id = `${base}-${++n}`;
  }
}

/**
 * All variation types, each with its items. Best-effort: returns [] if the tables aren't present
 * yet (0010 not run), so the catalog/quote pages never 500 on a missing migration.
 */
export async function getVariations(sb: SupabaseClient = admin()): Promise<VariationType[]> {
  const { data: types, error } = await sb.from("variation_types").select(TYPE_COLS).order("sort").order("name");
  if (error) return [];
  const { data: items, error: e2 } = await sb.from("variation_items").select(ITEM_COLS).order("sort").order("name");
  if (e2) return [];
  const all = ((items ?? []) as unknown as VariationItem[]).map((i) => ({ ...i, price: Number(i.price) }));
  return ((types ?? []) as unknown as Omit<VariationType, "items">[]).map((t) => ({
    ...t,
    items: all.filter((i) => i.variationId === t.id),
  }));
}

/** model_id → the item_ids available for it. Best-effort: {} if the table isn't present yet. */
export async function getProductVariationMap(sb: SupabaseClient = admin()): Promise<Record<string, string[]>> {
  const { data, error } = await sb.from("variation_product_items").select("model_id, item_id");
  if (error) return {};
  const map: Record<string, string[]> = {};
  for (const row of (data ?? []) as { model_id: string; item_id: string }[]) {
    (map[row.model_id] ??= []).push(row.item_id);
  }
  return map;
}

/** model_id → the item_ids marked default (pre-selected at quote time). Best-effort: {}. */
export async function getProductDefaultsMap(sb: SupabaseClient = admin()): Promise<Record<string, string[]>> {
  const { data, error } = await sb.from("variation_product_items").select("model_id, item_id").eq("is_default", true);
  if (error) return {};
  const map: Record<string, string[]> = {};
  for (const row of (data ?? []) as { model_id: string; item_id: string }[]) {
    (map[row.model_id] ??= []).push(row.item_id);
  }
  return map;
}

/** The variation types (with only the items available for `modelId`) — for the quote-time selector. */
export async function getVariationsForModel(modelId: string, sb: SupabaseClient = admin()): Promise<VariationType[]> {
  const [types, map] = await Promise.all([getVariations(sb), getProductVariationMap(sb)]);
  const allowed = new Set(map[modelId] ?? []);
  return types
    .map((t) => ({ ...t, items: t.items.filter((i) => allowed.has(i.id)) }))
    .filter((t) => t.items.length > 0);
}

// ---------------- admin writes ----------------

export async function createVariationType(
  name: string,
  pairGroup: string | null = null,
  sb: SupabaseClient = admin()
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Variation name is required");
  const id = await uniqueId("variation_types", slugify(trimmed), sb);
  const { error } = await sb.from("variation_types").insert({ id, name: trimmed, pair_group: pairGroup });
  if (error) throw error;
}

export async function updateVariationType(
  id: string,
  patch: { name?: string; sort?: number },
  sb: SupabaseClient = admin()
): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name.trim();
  if (patch.sort !== undefined) cols.sort = patch.sort;
  if (Object.keys(cols).length === 0) return;
  const { error } = await sb.from("variation_types").update(cols).eq("id", id);
  if (error) throw error;
}

export async function deleteVariationType(id: string, sb: SupabaseClient = admin()): Promise<void> {
  // items + product assignments cascade via FK.
  const { error } = await sb.from("variation_types").delete().eq("id", id);
  if (error) throw error;
}

export async function createVariationItem(
  variationId: string,
  name: string,
  price: number,
  image: string | null = null,
  sb: SupabaseClient = admin()
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Item name is required");
  const id = await uniqueId("variation_items", `${variationId}-${slugify(trimmed)}`, sb);
  const { error } = await sb
    .from("variation_items")
    .insert({ id, variation_id: variationId, name: trimmed, price, image_url: image || null });
  if (error) throw error;
}

export async function updateVariationItem(
  id: string,
  patch: { name?: string; price?: number; image?: string | null },
  sb: SupabaseClient = admin()
): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name.trim();
  if (patch.price !== undefined) cols.price = patch.price;
  if (patch.image !== undefined) cols.image_url = patch.image || null;
  if (Object.keys(cols).length === 0) return;
  const { error } = await sb.from("variation_items").update(cols).eq("id", id);
  if (error) throw error;
}

export async function deleteVariationItem(id: string, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("variation_items").delete().eq("id", id);
  if (error) throw error;
}

/** Replace which items are available for a model + which are default (delete-all-then-insert). */
export async function setProductVariationItems(
  modelId: string,
  itemIds: string[],
  defaultItemIds: string[] = [],
  sb: SupabaseClient = admin()
): Promise<void> {
  const del = await sb.from("variation_product_items").delete().eq("model_id", modelId);
  if (del.error) throw del.error;
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return;
  const { data: existing, error: exErr } = await sb.from("variation_items").select("id").in("id", unique);
  if (exErr) throw exErr;
  const valid = new Set((existing ?? []).map((r) => (r as { id: string }).id));
  const defaults = new Set(defaultItemIds);
  const rows = unique
    .filter((id) => valid.has(id))
    .map((item_id) => ({ model_id: modelId, item_id, is_default: defaults.has(item_id) }));
  if (rows.length === 0) return;
  const { error } = await sb.from("variation_product_items").insert(rows);
  if (error) throw error;
}

/**
 * Resolve the chosen item ids for a model into snapshot selections. Validates each item is
 * available for the model, and enforces the pair rule: within a `pair_group`, either every type
 * in the group is chosen or none is. Throws on a violation.
 */
export async function resolveVariationSelections(
  modelId: string,
  itemIds: string[],
  sb: SupabaseClient = admin()
): Promise<VariationSelection[]> {
  const chosen = [...new Set(itemIds)].filter(Boolean);
  if (chosen.length === 0) return [];
  const available = await getVariationsForModel(modelId, sb);
  const itemIndex = new Map<string, { type: VariationType; item: VariationItem }>();
  for (const t of available) for (const i of t.items) itemIndex.set(i.id, { type: t, item: i });

  const selections: VariationSelection[] = [];
  const chosenTypeIds = new Set<string>();
  for (const id of chosen) {
    const hit = itemIndex.get(id);
    if (!hit) throw new Error("A selected option is no longer available for this product");
    if (chosenTypeIds.has(hit.type.id)) throw new Error(`Pick only one ${hit.type.name}`);
    chosenTypeIds.add(hit.type.id);
    selections.push({
      variationId: hit.type.id,
      variationName: hit.type.name,
      itemId: hit.item.id,
      itemLabel: hit.item.name,
      price: hit.item.price,
    });
  }

  // Pair-group all-or-none: if any type in a group is chosen, all of that group's types
  // (that are available for this product) must be chosen.
  const groups = new Map<string, VariationType[]>();
  for (const t of available) if (t.pairGroup) (groups.get(t.pairGroup) ?? groups.set(t.pairGroup, []).get(t.pairGroup)!).push(t);
  for (const [, types] of groups) {
    const chosenInGroup = types.filter((t) => chosenTypeIds.has(t.id));
    if (chosenInGroup.length > 0 && chosenInGroup.length < types.length) {
      throw new Error(`${types.map((t) => t.name).join(" + ")} must be selected together`);
    }
  }
  return selections;
}
