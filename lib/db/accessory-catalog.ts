import { cache } from "react";
import { admin } from "@/lib/supabase/admin";
import {
  ACCESSORY_BRAND,
  ACCESSORY_CATEGORIES,
  ACCESSORY_MODELS,
  type AccessoryCategory,
  type AccessoryModel,
} from "@/lib/accessories-data";

// THE-772 Phase 2a — the accessory catalog (brand → category → model) read from the DB,
// falling back to the static catalog (lib/accessories-data.ts) when the 0006 tables are
// empty or missing, so nothing breaks before the migration is run + seeded.

export type AccessoryBrand = { id: string; name: string; tagline: string };

export type CatalogSnapshot = {
  brand: AccessoryBrand;
  categories: AccessoryCategory[];
  models: AccessoryModel[];
  category: (id: string) => AccessoryCategory | undefined;
  model: (id: string) => AccessoryModel | undefined;
  modelsIn: (categoryId?: string) => AccessoryModel[];
  /** model photo, falling back to the category's representative image */
  image: (m: AccessoryModel) => string;
};

function snapshot(brand: AccessoryBrand, categories: AccessoryCategory[], models: AccessoryModel[]): CatalogSnapshot {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const modById = new Map(models.map((m) => [m.id, m]));
  return {
    brand,
    categories,
    models,
    category: (id) => catById.get(id),
    model: (id) => modById.get(id),
    modelsIn: (categoryId) => (categoryId ? models.filter((m) => m.categoryId === categoryId) : models),
    image: (m) => m.imageUrl ?? catById.get(m.categoryId)?.image ?? "",
  };
}

const staticSnapshot = (): CatalogSnapshot => snapshot(ACCESSORY_BRAND, ACCESSORY_CATEGORIES, ACCESSORY_MODELS);

/** Backfill the DB from the static catalog (idempotent — only fills rows that don't exist). */
async function seedFromStatic(sb: ReturnType<typeof admin>): Promise<void> {
  await sb.from("accessory_brands").upsert(
    [{ id: ACCESSORY_BRAND.id, name: ACCESSORY_BRAND.name, tagline: ACCESSORY_BRAND.tagline, sort: 0 }],
    { onConflict: "id", ignoreDuplicates: true }
  );
  await sb.from("accessory_categories").upsert(
    ACCESSORY_CATEGORIES.map((c, i) => ({
      id: c.id, brand_id: ACCESSORY_BRAND.id, name: c.name, blurb: c.blurb,
      orderable: c.orderable, image_url: c.image, sort: i,
    })),
    { onConflict: "id", ignoreDuplicates: true }
  );
  await sb.from("accessory_models").upsert(
    ACCESSORY_MODELS.map((m, i) => ({
      id: m.id, category_id: m.categoryId, sku: m.sku, name: m.name, description: m.description,
      image_url: m.imageUrl ?? null, default_price: m.price, sort: i, active: true,
    })),
    { onConflict: "id", ignoreDuplicates: true }
  );
}

/** The accessory catalog for this request (DB if seeded, else the static fallback). Cached per request. */
export const loadCatalog = cache(async (): Promise<CatalogSnapshot> => {
  const sb = admin();
  const first = await sb.from("accessory_brands").select("id, name, tagline").order("sort");
  if (first.error) return staticSnapshot(); // tables not present yet (0006 not run) → static fallback
  let brands = first.data;
  if (!brands || brands.length === 0) {
    // tables exist but empty → one-time backfill from the static catalog, then re-read
    await seedFromStatic(sb);
    const reread = await sb.from("accessory_brands").select("id, name, tagline").order("sort");
    if (!reread.data || reread.data.length === 0) return staticSnapshot();
    brands = reread.data;
  }

  const { data: cats } = await sb
    .from("accessory_categories")
    .select("id, name, blurb, orderable, image:image_url, sort")
    .order("sort");
  const { data: mods } = await sb
    .from("accessory_models")
    .select("id, categoryId:category_id, sku, name, description, price:default_price, imageUrl:image_url, moq, shipGround:ship_ground, shipExpedite:ship_expedite, shipMode:ship_mode, active, sort")
    .order("sort");

  const categories = (cats ?? []) as unknown as AccessoryCategory[];
  const models = ((mods ?? []) as unknown as (AccessoryModel & { active?: boolean })[])
    .filter((m) => m.active !== false)
    .map((m) => ({
      ...m,
      price: m.price == null ? null : Number(m.price),
      moq: Number(m.moq ?? 0),
      shipGround: Number(m.shipGround ?? 0),
      shipExpedite: Number(m.shipExpedite ?? 0),
      shipMode: m.shipMode === "ground" ? ("ground" as const) : ("fob" as const),
    }));
  return snapshot(brands[0] as AccessoryBrand, categories, models);
});
