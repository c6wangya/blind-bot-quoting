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
  /** How many of this sub-part per parent motor unit (THE-772). */
  qty: number;
};
/**
 * A per-model exclusion group: a set of variation item ids of which at most ONE may be picked in a
 * config (the selected items are mutually exclusive). A model can have several groups, and a group
 * may span variation types (some Crowns + some Drives together). Supersedes the global pairwise
 * VariationRestriction (migration 0038).
 */
export type ExclusionGroup = { id: string; modelId: string; itemIds: string[] };

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

/** variation item_id → its catalog thumbnail + default (list) price. Best-effort: {} if table
 *  absent. Used by the invoice: add-on parts aren't image/price-snapshotted beyond what was charged,
 *  so their thumbnail and List (default catalog) price are looked up live by itemId. */
export async function getVariationItemDetails(
  sb: SupabaseClient = admin(),
): Promise<Record<string, { image: string | null; price: number }>> {
  const { data, error } = await sb.from("variation_items").select("id, price, image_url");
  if (error) return {};
  const map: Record<string, { image: string | null; price: number }> = {};
  for (const row of (data ?? []) as { id: string; price: number | null; image_url: string | null }[]) {
    map[row.id] = { image: row.image_url ?? null, price: Number(row.price ?? 0) };
  }
  return map;
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

/**
 * variation item_id → the catalog model it was synced from (variation_items.source_model_id).
 * Lets shipping charge a variation sub-part (e.g. a US-made bracket) at its own model's rate/mode.
 * Best-effort: {} if the table/column isn't present. Items with no source model are omitted.
 */
export async function getVariationItemModelMap(sb: SupabaseClient = admin()): Promise<Record<string, string>> {
  const { data, error } = await sb.from("variation_items").select("id, source_model_id").not("source_model_id", "is", null);
  if (error) return {};
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { id: string; source_model_id: string | null }[]) {
    if (row.source_model_id) map[row.id] = row.source_model_id;
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

/**
 * One customer's "kit": model_id → the default item ids an admin pre-configured for THIS retailer
 * (migration 0039). Overrides the store-wide `is_default` on a per-model basis. Best-effort: {} if
 * the table isn't present yet or `retailerId` is empty.
 */
export async function getRetailerDefaultsMap(
  retailerId: string,
  sb: SupabaseClient = admin()
): Promise<Record<string, string[]>> {
  if (!retailerId) return {};
  const { data, error } = await sb
    .from("variation_retailer_defaults")
    .select("model_id, item_id")
    .eq("retailer_id", retailerId);
  if (error) return {};
  const map: Record<string, string[]> = {};
  for (const row of (data ?? []) as { model_id: string; item_id: string }[]) {
    (map[row.model_id] ??= []).push(row.item_id);
  }
  return map;
}

/**
 * Replace ONE customer's default items for ONE model (delete-all-then-insert, scoped to
 * retailer+model). Items must be assigned to the model; we also enforce the model's exclusion
 * groups (keep at most one item per group, dropping later conflicts) so a saved kit is always a
 * valid selection — mirroring the customer-side gate. An empty `itemIds` clears the kit for this
 * model, falling the customer back to the store-wide default.
 */
export async function setRetailerProductDefaults(
  retailerId: string,
  modelId: string,
  itemIds: string[],
  sb: SupabaseClient = admin()
): Promise<void> {
  if (!retailerId) throw new Error("retailerId is required");
  if (!modelId) throw new Error("modelId is required");

  const { data: assigned, error: aErr } = await sb
    .from("variation_product_items")
    .select("item_id")
    .eq("model_id", modelId);
  if (aErr) throw aErr;
  const allowed = new Set((assigned ?? []).map((r) => (r as { item_id: string }).item_id));

  // Enforce exclusion groups: within a group only the first picked item survives.
  const groups = (await getExclusionGroupsMap(sb))[modelId] ?? [];
  const blocked = new Map<string, Set<string>>();
  for (const g of groups)
    for (const a of g) for (const b of g) if (a !== b) (blocked.get(a) ?? blocked.set(a, new Set()).get(a)!).add(b);
  const chosen: string[] = [];
  const taken = new Set<string>();
  for (const id of new Set(itemIds.filter((i) => allowed.has(i)))) {
    const c = blocked.get(id);
    if (c && [...taken].some((t) => c.has(t))) continue;
    chosen.push(id);
    taken.add(id);
  }

  const del = await sb
    .from("variation_retailer_defaults")
    .delete()
    .eq("retailer_id", retailerId)
    .eq("model_id", modelId);
  if (del.error) throw del.error;
  if (chosen.length === 0) return;
  const { error } = await sb
    .from("variation_retailer_defaults")
    .insert(chosen.map((item_id) => ({ retailer_id: retailerId, model_id: modelId, item_id })));
  if (error) throw error;
}

/**
 * model_id → its exclusion groups (each an array of item ids). Best-effort: {} if the tables
 * aren't present yet (0038 not run). Singleton/empty groups are dropped — they constrain nothing.
 */
export async function getExclusionGroupsMap(sb: SupabaseClient = admin()): Promise<Record<string, string[][]>> {
  const { data: groups, error } = await sb.from("variation_exclusion_groups").select("id, model_id");
  if (error) return {};
  const { data: items, error: e2 } = await sb.from("variation_exclusion_group_items").select("group_id, item_id");
  if (e2) return {};
  const itemsByGroup = new Map<string, string[]>();
  for (const r of (items ?? []) as { group_id: string; item_id: string }[]) {
    (itemsByGroup.get(r.group_id) ?? itemsByGroup.set(r.group_id, []).get(r.group_id)!).push(r.item_id);
  }
  const map: Record<string, string[][]> = {};
  for (const g of (groups ?? []) as { id: string; model_id: string }[]) {
    const ids = itemsByGroup.get(g.id) ?? [];
    if (ids.length >= 2) (map[g.model_id] ??= []).push(ids);
  }
  return map;
}

/**
 * Replace ALL exclusion groups for a model (delete-all-then-insert). Each input group is a list of
 * item ids; we dedup within a group, keep only items actually assigned to the model, and drop any
 * group left with fewer than 2 items (it would constrain nothing). Groups are inserted one at a
 * time so each row's generated id maps to the right item set (insert order isn't guaranteed on a
 * bulk `select`).
 */
export async function setModelExclusionGroups(
  modelId: string,
  groups: string[][],
  sb: SupabaseClient = admin()
): Promise<void> {
  if (!modelId) throw new Error("modelId is required");
  const { data: assigned, error: aErr } = await sb
    .from("variation_product_items")
    .select("item_id")
    .eq("model_id", modelId);
  if (aErr) throw aErr;
  const allowed = new Set((assigned ?? []).map((r) => (r as { item_id: string }).item_id));

  const clean = groups
    .map((g) => [...new Set(g.filter((id) => allowed.has(id)))])
    .filter((g) => g.length >= 2);

  // Wipe existing groups (group_items cascade) then insert the new set.
  const del = await sb.from("variation_exclusion_groups").delete().eq("model_id", modelId);
  if (del.error) throw del.error;

  for (let i = 0; i < clean.length; i++) {
    const { data: grp, error: gErr } = await sb
      .from("variation_exclusion_groups")
      .insert({ model_id: modelId, sort: i })
      .select("id")
      .single();
    if (gErr) throw gErr;
    const gid = (grp as { id: string }).id;
    const { error } = await sb
      .from("variation_exclusion_group_items")
      .insert(clean[i].map((item_id) => ({ group_id: gid, item_id })));
    if (error) throw error;
  }
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
 * Resolve the chosen item ids for a model into snapshot selections. Multi-select: any number of
 * items per type may be chosen. Validates each item is available for the model, and enforces the
 * model's exclusion groups (at most one selected item per group). Throws on a violation. The
 * client greys conflicting options out, but this is the authoritative gate.
 */
export async function resolveVariationSelections(
  modelId: string,
  requested: Array<{ itemId: string; qty?: number }>,
  sb: SupabaseClient = admin()
): Promise<VariationSelection[]> {
  // Dedup by itemId (last qty wins); a per-sub-part qty defaults to 1 and is clamped to [1, 999].
  const qtyByItem = new Map<string, number>();
  for (const r of requested) {
    if (!r.itemId) continue;
    qtyByItem.set(r.itemId, Math.max(1, Math.min(999, Math.round(r.qty || 1))));
  }
  const chosen = [...qtyByItem.keys()];
  if (chosen.length === 0) return [];
  const available = await getVariationsForModel(modelId, sb);
  const itemIndex = new Map<string, { type: VariationType; item: VariationItem }>();
  for (const t of available) for (const i of t.items) itemIndex.set(i.id, { type: t, item: i });

  const selections: VariationSelection[] = [];
  for (const id of chosen) {
    const hit = itemIndex.get(id);
    if (!hit) throw new Error("A selected option is no longer available for this product");
    selections.push({
      variationId: hit.type.id,
      variationName: hit.type.name,
      itemId: hit.item.id,
      itemLabel: hit.item.name,
      price: hit.item.price,
      qty: qtyByItem.get(id)!,
    });
  }

  // Exclusion groups: at most one selected item per group for this model.
  if (chosen.length > 1) {
    const chosenSet = new Set(chosen);
    const groups = (await getExclusionGroupsMap(sb))[modelId] ?? [];
    for (const g of groups) {
      const hits = g.filter((id) => chosenSet.has(id));
      if (hits.length > 1) {
        const names = hits.map((id) => itemIndex.get(id)?.item.name ?? "option");
        throw new Error(`${names.join(" and ")} can't be selected together`);
      }
    }
  }
  return selections;
}

// ---------------- sync a catalog category → a variation ----------------

export type SyncResult = { created: number; updated: number; removed: number; variationId: string };

/**
 * Mirror a catalog category's active models into a variation (one option per model), copying
 * name/price/image. Idempotent via source_category_id / source_model_id: re-running updates
 * matched options, adds new ones, removes options whose source model left the category, and
 * never touches manually-added (source-less) options.
 */
export async function syncCategoryToVariation(categoryId: string, sb: SupabaseClient = admin()): Promise<SyncResult> {
  const { data: cat } = await sb.from("accessory_categories").select("name").eq("id", categoryId).maybeSingle();
  if (!cat) throw new Error("Category not found");
  const catName = (cat as { name: string }).name;

  const { data: models } = await sb
    .from("accessory_models")
    .select("id, name, default_price, image_url")
    .eq("category_id", categoryId)
    .eq("active", true)
    .order("sort");
  const modelRows = (models ?? []) as { id: string; name: string; default_price: number | null; image_url: string | null }[];

  // find or create the variation linked to this category
  let variationId: string;
  const { data: existingType } = await sb.from("variation_types").select("id").eq("source_category_id", categoryId).maybeSingle();
  if (existingType) {
    variationId = (existingType as { id: string }).id;
    await sb.from("variation_types").update({ name: catName }).eq("id", variationId);
  } else {
    variationId = await uniqueId("variation_types", slugify(catName), sb);
    const { error } = await sb.from("variation_types").insert({ id: variationId, name: catName, source_category_id: categoryId });
    if (error) throw error;
  }

  // existing synced options (by source_model_id)
  const { data: existingItems } = await sb
    .from("variation_items")
    .select("id, source_model_id")
    .eq("variation_id", variationId)
    .not("source_model_id", "is", null);
  const bySource = new Map<string, string>();
  for (const r of (existingItems ?? []) as { id: string; source_model_id: string }[]) bySource.set(r.source_model_id, r.id);

  let created = 0;
  let updated = 0;
  const seen = new Set<string>();
  for (const m of modelRows) {
    seen.add(m.id);
    const price = m.default_price == null ? 0 : Number(m.default_price);
    const existingId = bySource.get(m.id);
    if (existingId) {
      await sb.from("variation_items").update({ name: m.name, price, image_url: m.image_url }).eq("id", existingId);
      updated++;
    } else {
      const id = await uniqueId("variation_items", `${variationId}-${slugify(m.name)}`, sb);
      const { error } = await sb
        .from("variation_items")
        .insert({ id, variation_id: variationId, name: m.name, price, image_url: m.image_url, source_model_id: m.id });
      if (error) throw error;
      created++;
    }
  }

  // remove synced options whose source model left the category (manual options untouched)
  let removed = 0;
  for (const [src, itemId] of bySource) {
    if (!seen.has(src)) {
      await sb.from("variation_items").delete().eq("id", itemId);
      removed++;
    }
  }

  return { created, updated, removed, variationId };
}
