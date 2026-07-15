import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { setModelNote } from "@/lib/db";

/** Save a model's compatibility-note body (free text). Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = (await req.json().catch(() => ({}))) as { modelId?: string; body?: string };
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!modelId) return NextResponse.json({ error: "modelId required" }, { status: 400 });
    await setModelNote(modelId, typeof body.body === "string" ? body.body : "");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
