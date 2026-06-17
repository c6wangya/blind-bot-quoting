import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { clearStock, setStock } from "@/lib/db";

/** Set or clear a motor's stock. Body: { modelId, stock } | { modelId, clear: true }. Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const { modelId, stock, clear } = await req.json();
    if (typeof modelId !== "string" || !modelId) {
      return NextResponse.json({ error: "modelId required" }, { status: 400 });
    }
    if (clear === true) {
      await clearStock(modelId);
      return NextResponse.json({ ok: true });
    }
    if (typeof stock !== "number" || !Number.isFinite(stock) || stock < 0) {
      return NextResponse.json({ error: "stock must be a non-negative number" }, { status: 400 });
    }
    await setStock(modelId, stock);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
