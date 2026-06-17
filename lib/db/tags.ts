import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { AccessoryAttribute, AccessoryAttributeValue } from "@/lib/types";

// Accessory tag system — admin-managed faceted attributes for filtering accessory models.
// Reads are public catalog metadata (admin() = system read); writes go through a userClient
// so RLS enforces is_admin() (the API routes also gate on isAdmin as defense-in-depth).

const ATTR_COLS = "id, name, multi, sort";
const VALUE_COLS = "id, attributeId:attribute_id, label, sort";

export type AttributeWithValues = AccessoryAttribute & { values: AccessoryAttributeValue[] };

/**
 * All attributes, each with its values, ordered by sort then name/label.
 * Best-effort: returns [] if the tag tables aren't present yet (0002 not run), so the
 * retailer-facing catalog never 500s on a missing migration — it just shows no filters.
 */
export async function getAttributes(sb: SupabaseClient = admin()): Promise<AttributeWithValues[]> {
  const { data: attrs, error } = await sb
    .from("accessory_attributes")
    .select(ATTR_COLS)
    .order("sort")
    .order("name");
  if (error) return [];
  const { data: vals, error: e2 } = await sb
    .from("accessory_attribute_values")
    .select(VALUE_COLS)
    .order("sort")
    .order("label");
  if (e2) return [];
  const values = (vals ?? []) as unknown as AccessoryAttributeValue[];
  return ((attrs ?? []) as unknown as AccessoryAttribute[]).map((a) => ({
    ...a,
    values: values.filter((v) => v.attributeId === a.id),
  }));
}

/** model_id → the value_ids assigned to it. Best-effort: {} if the table isn't present yet. */
export async function getModelTagMap(sb: SupabaseClient = admin()): Promise<Record<string, string[]>> {
  const { data, error } = await sb.from("accessory_model_tags").select("model_id, value_id");
  if (error) return {};
  const map: Record<string, string[]> = {};
  for (const row of (data ?? []) as { model_id: string; value_id: string }[]) {
    (map[row.model_id] ??= []).push(row.value_id);
  }
  return map;
}

// ---------------- admin writes ----------------

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function uniqueId(table: string, base: string, sb: SupabaseClient): Promise<string> {
  let id = base || "x";
  let n = 1;
  for (;;) {
    const { data } = await sb.from(table).select("id").eq("id", id).maybeSingle();
    if (!data) return id;
    id = `${base}-${++n}`;
  }
}

export async function createAttribute(name: string, multi: boolean, sb: SupabaseClient = admin()): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Attribute name is required");
  const id = await uniqueId("accessory_attributes", slugify(trimmed), sb);
  const { error } = await sb.from("accessory_attributes").insert({ id, name: trimmed, multi });
  if (error) throw error;
}

export async function deleteAttribute(id: string, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("accessory_attributes").delete().eq("id", id);
  if (error) throw error;
}

export async function addAttributeValue(attributeId: string, label: string, sb: SupabaseClient = admin()): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Value label is required");
  const id = await uniqueId("accessory_attribute_values", `${attributeId}-${slugify(trimmed)}`, sb);
  const { error } = await sb
    .from("accessory_attribute_values")
    .insert({ id, attribute_id: attributeId, label: trimmed });
  if (error) throw error;
}

export async function deleteAttributeValue(id: string, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("accessory_attribute_values").delete().eq("id", id);
  if (error) throw error;
}

/** Replace a model's full tag set (delete-all-then-insert; the per-model set is tiny). */
export async function setModelTags(modelId: string, valueIds: string[], sb: SupabaseClient = admin()): Promise<void> {
  const del = await sb.from("accessory_model_tags").delete().eq("model_id", modelId);
  if (del.error) throw del.error;
  const unique = [...new Set(valueIds)];
  if (unique.length) {
    const { error } = await sb
      .from("accessory_model_tags")
      .insert(unique.map((value_id) => ({ model_id: modelId, value_id })));
    if (error) throw error;
  }
}
