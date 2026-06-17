import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { setModelTags } from "@/lib/db";
import { getAccessoryModel } from "@/lib/accessories-data";

/** Replace a model's full tag set. Body: { modelId: string, valueIds: string[] }. Admin only. */
export async function PUT(req: Request) {
  const sb = await requireAdmin();
  if (sb instanceof NextResponse) return sb;
  try {
    const { modelId, valueIds } = await req.json();
    if (typeof modelId !== "string" || !getAccessoryModel(modelId)) {
      return NextResponse.json({ error: "Unknown model" }, { status: 400 });
    }
    if (!Array.isArray(valueIds) || valueIds.some((v) => typeof v !== "string")) {
      return NextResponse.json({ error: "valueIds must be a string array" }, { status: 400 });
    }
    await setModelTags(modelId, valueIds, sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
