import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { syncCategoryToVariation } from "@/lib/db";

/** Sync a catalog category's products into a matching variation (one option per product). Admin. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const b = await req.json();
    if (typeof b.categoryId !== "string") return NextResponse.json({ error: "categoryId required" }, { status: 400 });
    const result = await syncCategoryToVariation(b.categoryId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
