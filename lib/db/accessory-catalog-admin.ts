import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { AccessoryCategory, AccessoryModel } from "@/lib/accessories-data";
import type { AccessoryBrand } from "./accessory-catalog";
import { round2 } from "./internal";

// THE-772 Phase 2b — admin CRUD for the accessory catalog (brand → category → model).
// image_url is set either by direct URL or via upload (POST /api/motors/catalog/image).

export const ACCESSORY_BUCKET = "accessory-images";

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ---------------- per-model attachments (spec sheets, certifications) ----------------

export type ModelFileKind = "spec" | "certification" | "other";
export type AccessoryModelFile = { id: string; modelId: string; name: string; url: string; kind: ModelFileKind; sort: number };

function publicUrl(path: string, sb: SupabaseClient): string {
  return sb.storage.from(ACCESSORY_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** model_id → its attachments (public URLs derived). Best-effort: {} if the table isn't present. */
export async function getModelFilesMap(sb: SupabaseClient = admin()): Promise<Record<string, AccessoryModelFile[]>> {
  const { data, error } = await sb
    .from("accessory_model_files")
    .select("id, modelId:model_id, name, path, kind, sort")
    .order("sort")
    .order("created_at");
  if (error) return {};
  const map: Record<string, AccessoryModelFile[]> = {};
  for (const r of (data ?? []) as { id: string; modelId: string; name: string; path: string; kind: ModelFileKind; sort: number }[]) {
    (map[r.modelId] ??= []).push({ id: r.id, modelId: r.modelId, name: r.name, kind: r.kind, sort: r.sort, url: publicUrl(r.path, sb) });
  }
  return map;
}

export async function addModelFile(
  modelId: string,
  file: { name: string; path: string; kind: ModelFileKind },
  sb: SupabaseClient = admin()
): Promise<void> {
  const id = `f-${Math.random().toString(36).slice(2, 12)}`;
  const { error } = await sb
    .from("accessory_model_files")
    .insert({ id, model_id: modelId, name: file.name, path: file.path, kind: file.kind });
  if (error) throw error;
}

export async function deleteModelFile(id: string, sb: SupabaseClient = admin()): Promise<void> {
  const { data } = await sb.from("accessory_model_files").select("path").eq("id", id).maybeSingle();
  const path = (data as { path: string } | null)?.path;
  if (path) await admin().storage.from(ACCESSORY_BUCKET).remove([path]).then(() => {}, () => {});
  const { error } = await sb.from("accessory_model_files").delete().eq("id", id);
  if (error) throw error;
}

// ---------------- per-model compatibility note (free text + images, retailer-facing) ----------------

export type AccessoryNoteImage = { id: string; url: string };
export type AccessoryModelNote = { body: string; images: AccessoryNoteImage[] };

/** model_id → its compatibility note (body + images, public URLs derived). Best-effort: {} if the
 *  tables aren't present yet (migration 0043 not run). Only models WITH a note appear. */
export async function getModelNotesMap(sb: SupabaseClient = admin()): Promise<Record<string, AccessoryModelNote>> {
  const [notes, images] = await Promise.all([
    sb.from("accessory_model_notes").select("modelId:model_id, body"),
    sb.from("accessory_model_note_images").select("id, modelId:model_id, path").order("sort").order("created_at"),
  ]);
  if (notes.error) return {};
  const map: Record<string, AccessoryModelNote> = {};
  for (const r of (notes.data ?? []) as { modelId: string; body: string }[]) map[r.modelId] = { body: r.body ?? "", images: [] };
  for (const r of (images.data ?? []) as { id: string; modelId: string; path: string }[]) {
    (map[r.modelId] ??= { body: "", images: [] }).images.push({ id: r.id, url: publicUrl(r.path, sb) });
  }
  return map;
}

/** Upsert a model's note body (empty string clears the text but keeps any images). */
export async function setModelNote(modelId: string, body: string, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb
    .from("accessory_model_notes")
    .upsert({ model_id: modelId, body, updated_at: new Date().toISOString() }, { onConflict: "model_id" });
  if (error) throw error;
}

/** Attach an uploaded image (already in the accessory-images bucket) to a model's note. */
export async function addNoteImage(modelId: string, path: string, sb: SupabaseClient = admin()): Promise<AccessoryNoteImage> {
  const id = `ni-${Math.random().toString(36).slice(2, 12)}`;
  const { error } = await sb.from("accessory_model_note_images").insert({ id, model_id: modelId, path });
  if (error) throw error;
  return { id, url: publicUrl(path, sb) };
}

export async function deleteNoteImage(id: string, sb: SupabaseClient = admin()): Promise<void> {
  const { data } = await sb.from("accessory_model_note_images").select("path").eq("id", id).maybeSingle();
  const path = (data as { path: string } | null)?.path;
  if (path) await admin().storage.from(ACCESSORY_BUCKET).remove([path]).then(() => {}, () => {});
  const { error } = await sb.from("accessory_model_note_images").delete().eq("id", id);
  if (error) throw error;
}

async function uniqueId(table: string, base: string, sb: SupabaseClient): Promise<string> {
  let id = base || "x";
  let n = 1;
  for (;;) {
    const { data } = await sb.from(table).select("id").eq("id", id).maybeSingle();
    if (!data) return id;
    id = `${base}-${++n}`;
  }
}

// ---------------- admin read (includes inactive models, category.brandId) ----------------

export type AdminCategory = AccessoryCategory & { brandId: string };
export type AdminModel = AccessoryModel & { active: boolean };
export type AdminCatalog = { brands: AccessoryBrand[]; categories: AdminCategory[]; models: AdminModel[] };

export async function loadCatalogAdmin(sb: SupabaseClient = admin()): Promise<AdminCatalog> {
  const { data: brands } = await sb.from("accessory_brands").select("id, name, tagline").order("sort").order("name");
  const { data: cats } = await sb
    .from("accessory_categories")
    .select("id, brandId:brand_id, name, blurb, orderable, image:image_url, sort")
    .order("sort");
  const { data: mods } = await sb
    .from("accessory_models")
    .select("id, categoryId:category_id, sku, name, description, price:default_price, imageUrl:image_url, moq, active, sort")
    .order("sort");
  return {
    brands: (brands ?? []) as unknown as AccessoryBrand[],
    categories: (cats ?? []) as unknown as AdminCategory[],
    models: ((mods ?? []) as unknown as AdminModel[]).map((m) => ({ ...m, price: m.price == null ? null : Number(m.price) })),
  };
}

// ---------------- brands ----------------

export async function createBrand(name: string, tagline: string, sb: SupabaseClient = admin()): Promise<void> {
  const n = name.trim();
  if (!n) throw new Error("Brand name is required");
  const id = await uniqueId("accessory_brands", slug(n), sb);
  const { error } = await sb.from("accessory_brands").insert({ id, name: n, tagline: tagline.trim() || null });
  if (error) throw error;
}

export async function updateBrand(
  id: string,
  patch: { name?: string; tagline?: string },
  sb: SupabaseClient = admin()
): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name.trim();
  if (patch.tagline !== undefined) cols.tagline = patch.tagline.trim() || null;
  if (Object.keys(cols).length === 0) return;
  const { error } = await sb.from("accessory_brands").update(cols).eq("id", id);
  if (error) throw error;
}

export async function deleteBrand(id: string, sb: SupabaseClient = admin()): Promise<void> {
  const { count } = await sb.from("accessory_categories").select("id", { count: "exact", head: true }).eq("brand_id", id);
  if (count && count > 0) throw new Error("Remove this brand's categories first");
  const { error } = await sb.from("accessory_brands").delete().eq("id", id);
  if (error) throw error;
}

// ---------------- categories ----------------

export async function createCategory(
  brandId: string,
  name: string,
  opts: { blurb?: string; orderable?: boolean; image?: string } = {},
  sb: SupabaseClient = admin()
): Promise<void> {
  const n = name.trim();
  if (!n) throw new Error("Category name is required");
  const id = await uniqueId("accessory_categories", slug(n), sb);
  const { error } = await sb.from("accessory_categories").insert({
    id, brand_id: brandId, name: n, blurb: opts.blurb?.trim() || null,
    orderable: opts.orderable ?? false, image_url: opts.image?.trim() || null,
  });
  if (error) throw error;
}

export async function updateCategory(
  id: string,
  patch: { name?: string; blurb?: string; orderable?: boolean; image?: string; sort?: number },
  sb: SupabaseClient = admin()
): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (patch.name !== undefined) cols.name = patch.name.trim();
  if (patch.blurb !== undefined) cols.blurb = patch.blurb.trim() || null;
  if (patch.orderable !== undefined) cols.orderable = patch.orderable;
  if (patch.image !== undefined) cols.image_url = patch.image.trim() || null;
  if (patch.sort !== undefined) cols.sort = patch.sort;
  if (Object.keys(cols).length === 0) return;
  const { error } = await sb.from("accessory_categories").update(cols).eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id: string, sb: SupabaseClient = admin()): Promise<void> {
  const { count } = await sb.from("accessory_models").select("id", { count: "exact", head: true }).eq("category_id", id);
  if (count && count > 0) throw new Error("Remove this category's models first");
  const { error } = await sb.from("accessory_categories").delete().eq("id", id);
  if (error) throw error;
}

// ---------------- models ----------------

export type QuoteRef = { quoteId: number; ref: string | null };

/**
 * Quotes that reference this model. Quote lines snapshot the product (name/sku/price/image), so
 * deleting the model doesn't break them — this is just to warn the admin where it's used.
 */
export async function quotesReferencingModel(id: string, sb: SupabaseClient = admin()): Promise<QuoteRef[]> {
  const { data: items } = await sb.from("quote_items").select("quote_id").eq("product_id", id);
  const ids = [...new Set((items ?? []).map((r) => r.quote_id as number))];
  if (!ids.length) return [];
  const { data: quotes } = await sb.from("quotes").select("id, ref").in("id", ids);
  return (quotes ?? []).map((q) => ({ quoteId: q.id as number, ref: (q.ref as string) ?? null }));
}

export async function createModel(
  categoryId: string,
  sku: string,
  name: string,
  opts: { description?: string; price?: number | null; image?: string } = {},
  sb: SupabaseClient = admin()
): Promise<void> {
  const s = sku.trim();
  const n = name.trim();
  if (!s || !n) throw new Error("SKU and name are required");
  // Append a random suffix so a model id is never REUSED: a deleted product's leftover
  // quote_items still point at its old id, so a same-SKU re-creation must not inherit it.
  const id = await uniqueId("accessory_models", `${slug(s)}-${Math.random().toString(36).slice(2, 7)}`, sb);
  const { error } = await sb.from("accessory_models").insert({
    id, category_id: categoryId, sku: s, name: n,
    description: opts.description?.trim() || null,
    default_price: opts.price ?? null,
    image_url: opts.image?.trim() || null,
    active: true,
  });
  if (error) throw error;
}

export async function updateModel(
  id: string,
  patch: {
    categoryId?: string; sku?: string; name?: string; description?: string;
    price?: number | null; image?: string; active?: boolean; sort?: number; moq?: number;
    shipGround?: number; shipExpedite?: number; shipMode?: "fob" | "ground";
  },
  sb: SupabaseClient = admin()
): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (patch.categoryId !== undefined) cols.category_id = patch.categoryId;
  if (patch.sku !== undefined) cols.sku = patch.sku.trim();
  if (patch.name !== undefined) cols.name = patch.name.trim();
  if (patch.description !== undefined) cols.description = patch.description.trim() || null;
  if (patch.price !== undefined) cols.default_price = patch.price;
  if (patch.image !== undefined) cols.image_url = patch.image.trim() || null;
  if (patch.active !== undefined) cols.active = patch.active;
  if (patch.sort !== undefined) cols.sort = patch.sort;
  if (patch.moq !== undefined) cols.moq = Math.max(0, Math.round(patch.moq));
  if (patch.shipGround !== undefined) cols.ship_ground = Math.max(0, round2(patch.shipGround));
  if (patch.shipExpedite !== undefined) cols.ship_expedite = Math.max(0, round2(patch.shipExpedite));
  if (patch.shipMode !== undefined) cols.ship_mode = patch.shipMode === "ground" ? "ground" : "fob";
  if (Object.keys(cols).length === 0) return;
  const { error } = await sb.from("accessory_models").update(cols).eq("id", id);
  if (error) throw error;
}

/** Batch-set per-motor shipping rates + mode ("Save all" on the Shipping tab). */
export async function setMotorShippingBatch(
  rates: { modelId: string; ground: number; expedite: number; mode: "fob" | "ground" }[],
  sb: SupabaseClient = admin()
): Promise<void> {
  for (const r of rates) {
    await updateModel(r.modelId, { shipGround: r.ground, shipExpedite: r.expedite, shipMode: r.mode }, sb);
  }
}

export type DeleteModelResult =
  | { status: "deleted" }
  | { status: "referenced"; quotes: QuoteRef[] };

/**
 * Delete a model. If it's used in any quote and `force` is not set, returns those quotes so the
 * admin can confirm — nothing is deleted. With `force` (or when unused), the model + its config
 * rows (inventory / pricing / tags) are removed; quote lines keep their snapshot, so historical
 * quotes/orders still render. quote_items are intentionally left untouched.
 */
export async function deleteModel(
  id: string,
  sb: SupabaseClient = admin(),
  force = false
): Promise<DeleteModelResult> {
  const refs = await quotesReferencingModel(id, sb);
  if (refs.length && !force) return { status: "referenced", quotes: refs };
  // No FK cascade (these tables predate accessory_models) — clear config rows explicitly.
  await sb.from("accessory_inventory").delete().eq("model_id", id);
  await sb.from("accessory_prices").delete().eq("model_id", id);
  await sb.from("accessory_model_tags").delete().eq("model_id", id);
  // Compatible-variation entries owned by this model, plus any entry (on another model) that
  // referenced it as a checked item. Both FK-cascade from accessory_models (0041), but delete
  // explicitly per convention; the owned entries' item rows cascade from the entry delete.
  await sb.from("accessory_compat_variation_items").delete().eq("item_model_id", id);
  await sb.from("accessory_model_compat_variations").delete().eq("model_id", id);
  await sb.from("variation_product_items").delete().eq("model_id", id);
  // Exclusion groups DO cascade from accessory_models (0038), but delete explicitly per convention
  // (their group_items rows cascade from the group delete).
  await sb.from("variation_exclusion_groups").delete().eq("model_id", id);
  // Per-customer default "kits" (0039) cascade from accessory_models too, but delete per convention.
  await sb.from("variation_retailer_defaults").delete().eq("model_id", id);
  // Attachment rows cascade via FK; remove their storage objects too (not covered by cascade).
  const { data: files } = await sb.from("accessory_model_files").select("path").eq("model_id", id);
  const paths = ((files ?? []) as { path: string }[]).map((f) => f.path);
  if (paths.length) await admin().storage.from(ACCESSORY_BUCKET).remove(paths).then(() => {}, () => {});
  // Compatibility-note rows cascade via FK (0043), but remove their storage objects too. The note
  // row itself also cascades; delete both explicitly per convention.
  const { data: noteImgs } = await sb.from("accessory_model_note_images").select("path").eq("model_id", id);
  const notePaths = ((noteImgs ?? []) as { path: string }[]).map((f) => f.path);
  if (notePaths.length) await admin().storage.from(ACCESSORY_BUCKET).remove(notePaths).then(() => {}, () => {});
  await sb.from("accessory_model_note_images").delete().eq("model_id", id);
  await sb.from("accessory_model_notes").delete().eq("model_id", id);
  const { error } = await sb.from("accessory_models").delete().eq("id", id);
  if (error) throw error;
  return { status: "deleted" };
}
