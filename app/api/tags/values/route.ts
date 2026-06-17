import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { addAttributeValue, deleteAttributeValue } from "@/lib/db";

/** Add a value to an attribute. Body: { attributeId: string, label: string }. Admin only. */
export async function POST(req: Request) {
  const sb = await requireAdmin();
  if (sb instanceof NextResponse) return sb;
  try {
    const { attributeId, label } = await req.json();
    if (typeof attributeId !== "string" || !attributeId) {
      return NextResponse.json({ error: "attributeId is required" }, { status: 400 });
    }
    if (typeof label !== "string" || !label.trim()) {
      return NextResponse.json({ error: "Label is required" }, { status: 400 });
    }
    await addAttributeValue(attributeId, label, sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Delete a value (cascades its assignments). Body: { id: string }. Admin only. */
export async function DELETE(req: Request) {
  const sb = await requireAdmin();
  if (sb instanceof NextResponse) return sb;
  try {
    const { id } = await req.json();
    if (typeof id !== "string" || !id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await deleteAttributeValue(id, sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
