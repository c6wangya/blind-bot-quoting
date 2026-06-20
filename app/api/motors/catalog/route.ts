import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import {
  createBrand,
  createCategory,
  createModel,
  deleteBrand,
  deleteCategory,
  deleteModel,
  quotesReferencingModel,
  updateBrand,
  updateCategory,
  updateModel,
} from "@/lib/db";

type Entity = "brand" | "category" | "model";
const isEntity = (e: unknown): e is Entity => e === "brand" || e === "category" || e === "model";

// Parse an optional price field → number | null (empty/null → null).
const asPrice = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Create a brand / category / model. Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const b = await req.json();
    if (!isEntity(b.entity)) return NextResponse.json({ error: "Unknown entity" }, { status: 400 });
    if (b.entity === "brand") await createBrand(String(b.name ?? ""), String(b.tagline ?? ""));
    else if (b.entity === "category")
      await createCategory(String(b.brandId ?? ""), String(b.name ?? ""), {
        blurb: b.blurb, orderable: b.orderable === true, image: b.image,
      });
    else
      await createModel(String(b.categoryId ?? ""), String(b.sku ?? ""), String(b.name ?? ""), {
        description: b.description, price: asPrice(b.price) ?? null, image: b.image,
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Update a brand / category / model. Admin only. */
export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const b = await req.json();
    if (!isEntity(b.entity) || typeof b.id !== "string") {
      return NextResponse.json({ error: "entity + id required" }, { status: 400 });
    }
    if (b.entity === "brand") await updateBrand(b.id, { name: b.name, tagline: b.tagline });
    else if (b.entity === "category")
      await updateCategory(b.id, { name: b.name, blurb: b.blurb, orderable: b.orderable, image: b.image, sort: b.sort });
    else
      await updateModel(b.id, {
        categoryId: b.categoryId, sku: b.sku, name: b.name, description: b.description,
        price: asPrice(b.price), image: b.image, active: b.active, sort: b.sort,
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Delete a brand / category / model (models soft-delete when referenced). Admin only. */
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const b = await req.json();
    if (!isEntity(b.entity) || typeof b.id !== "string") {
      return NextResponse.json({ error: "entity + id required" }, { status: 400 });
    }
    if (b.entity === "brand") await deleteBrand(b.id);
    else if (b.entity === "category") await deleteCategory(b.id);
    else {
      // check-only: report which quotes reference the model without deleting (drives the confirm)
      if (b.check === true) return NextResponse.json({ ok: true, quotes: await quotesReferencingModel(b.id) });
      const result = await deleteModel(b.id, undefined, b.force === true);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
