import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import {
  createCompatVariation,
  deleteCompatVariation,
  loadCatalog,
  setVariationItems,
  updateCompatVariation,
} from "@/lib/db";

// Admin CRUD for the accessory compatibility system (0041) — per-model "Compatible variation"
// entries (name + image) that check any number of other catalog models.

/** Create an entry for a model. Body: { modelId, name }. Returns { id }. */
export async function POST(req: Request) {
  const sb = await requireAdmin();
  if (sb instanceof NextResponse) return sb;
  try {
    const { modelId, name } = await req.json();
    const cat = await loadCatalog();
    if (typeof modelId !== "string" || !cat.model(modelId)) {
      return NextResponse.json({ error: "Unknown model" }, { status: 400 });
    }
    const id = await createCompatVariation(modelId, String(name ?? ""), sb);
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/**
 * Update an entry. Body: { variationId, name?, imageUrl?, itemIds? }.
 * name/imageUrl patch the entry; itemIds replaces its checked items.
 */
export async function PUT(req: Request) {
  const sb = await requireAdmin();
  if (sb instanceof NextResponse) return sb;
  try {
    const { variationId, name, imageUrl, itemIds } = await req.json();
    if (typeof variationId !== "string") {
      return NextResponse.json({ error: "variationId is required" }, { status: 400 });
    }
    if (name !== undefined || imageUrl !== undefined) {
      await updateCompatVariation(variationId, { name, imageUrl }, sb);
    }
    if (itemIds !== undefined) {
      if (!Array.isArray(itemIds) || itemIds.some((v) => typeof v !== "string")) {
        return NextResponse.json({ error: "itemIds must be a string array" }, { status: 400 });
      }
      await setVariationItems(variationId, itemIds, sb);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Delete an entry. Body: { variationId }. */
export async function DELETE(req: Request) {
  const sb = await requireAdmin();
  if (sb instanceof NextResponse) return sb;
  try {
    const { variationId } = await req.json();
    if (typeof variationId !== "string") {
      return NextResponse.json({ error: "variationId is required" }, { status: 400 });
    }
    await deleteCompatVariation(variationId, sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
