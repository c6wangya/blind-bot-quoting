import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { AccessoryCategory, AccessoryModel } from "@/lib/accessories-data";
import type { AccessoryBrand } from "./accessory-catalog";

// THE-772 Phase 2b — admin CRUD for the accessory catalog (brand → category → model).
// image_url is set either by direct URL or via upload (POST /api/motors/catalog/image).

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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
    .select("id, categoryId:category_id, sku, name, description, price:default_price, imageUrl:image_url, active, sort")
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
  const id = await uniqueId("accessory_models", slug(s), sb);
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
    price?: number | null; image?: string; active?: boolean; sort?: number;
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
  if (Object.keys(cols).length === 0) return;
  const { error } = await sb.from("accessory_models").update(cols).eq("id", id);
  if (error) throw error;
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
  const { error } = await sb.from("accessory_models").delete().eq("id", id);
  if (error) throw error;
  return { status: "deleted" };
}
