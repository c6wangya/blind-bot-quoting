import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { CompatVariation } from "@/lib/types";

// Accessory compatibility ("Compatible variation") — per-model named + imaged fitment entries.
// Each entry references any number of other catalog models (by id); the retailer accessory page
// groups them by category and shows them next to the part. Distinct from the tag system
// (lib/db/tags.ts): tags filter, this describes what an accessory physically fits.
// Reads are public catalog metadata (admin() = system read); writes go through a userClient so
// RLS enforces is_admin() (the API route also gates on isAdmin as defense-in-depth).
// See supabase/migrations/0041_accessory_compat.sql.

const VAR_COLS = "id, modelId:model_id, name, imageUrl:image_url, sort";

/**
 * model_id → its compatible-variation entries (each with its checked item ids), ordered by sort.
 * Best-effort: returns {} if the tables aren't present yet (0041 not run), so the catalog never
 * 500s on a missing migration — it just shows no compatibility entries.
 */
export async function getModelCompatVariations(
  sb: SupabaseClient = admin()
): Promise<Record<string, CompatVariation[]>> {
  const { data: vars, error } = await sb
    .from("accessory_model_compat_variations")
    .select(VAR_COLS)
    .order("sort")
    .order("created_at");
  if (error) return {};
  const { data: items, error: e2 } = await sb
    .from("accessory_compat_variation_items")
    .select("variation_id, item_model_id");
  if (e2) return {};
  const itemsByVar: Record<string, string[]> = {};
  for (const r of (items ?? []) as { variation_id: string; item_model_id: string }[]) {
    (itemsByVar[r.variation_id] ??= []).push(r.item_model_id);
  }
  const map: Record<string, CompatVariation[]> = {};
  for (const v of (vars ?? []) as unknown as Omit<CompatVariation, "itemIds">[]) {
    (map[v.modelId] ??= []).push({ ...v, itemIds: itemsByVar[v.id] ?? [] });
  }
  return map;
}

// ---------------- admin writes ----------------

function newId(): string {
  return `cv-${crypto.randomUUID().slice(0, 12)}`;
}

/** Create an (empty, unnamed) compatible-variation entry for a model. Returns the new id. */
export async function createCompatVariation(
  modelId: string,
  name: string,
  sb: SupabaseClient = admin()
): Promise<string> {
  const trimmed = name.trim();
  const id = newId();
  // Append after existing entries.
  const { data: last } = await sb
    .from("accessory_model_compat_variations")
    .select("sort")
    .eq("model_id", modelId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort = ((last as { sort: number } | null)?.sort ?? -1) + 1;
  const { error } = await sb
    .from("accessory_model_compat_variations")
    .insert({ id, model_id: modelId, name: trimmed, sort });
  if (error) throw error;
  return id;
}

/** Update an entry's name and/or image. Pass imageUrl: null to clear the image. */
export async function updateCompatVariation(
  id: string,
  patch: { name?: string; imageUrl?: string | null },
  sb: SupabaseClient = admin()
): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name.trim();
  if (patch.imageUrl !== undefined) cols.image_url = patch.imageUrl || null;
  if (Object.keys(cols).length === 0) return;
  const { error } = await sb.from("accessory_model_compat_variations").update(cols).eq("id", id);
  if (error) throw error;
}

/** Delete a compatible-variation entry (its item rows cascade). */
export async function deleteCompatVariation(id: string, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("accessory_model_compat_variations").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Replace a variation's full set of checked catalog-model items (delete-all-then-insert; the set
 * is small). Only keeps ids that still exist as models — a stale client could otherwise hit the FK.
 */
export async function setVariationItems(
  variationId: string,
  itemModelIds: string[],
  sb: SupabaseClient = admin()
): Promise<void> {
  const del = await sb.from("accessory_compat_variation_items").delete().eq("variation_id", variationId);
  if (del.error) throw del.error;
  const unique = [...new Set(itemModelIds)];
  if (unique.length === 0) return;
  const { data: existing, error: exErr } = await sb
    .from("accessory_models")
    .select("id")
    .in("id", unique);
  if (exErr) throw exErr;
  const valid = new Set((existing ?? []).map((r) => (r as { id: string }).id));
  const rows = unique
    .filter((id) => valid.has(id))
    .map((item_model_id) => ({ variation_id: variationId, item_model_id }));
  if (rows.length === 0) return;
  const { error } = await sb.from("accessory_compat_variation_items").insert(rows);
  if (error) throw error;
}
