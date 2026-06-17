import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { createAttribute, deleteAttribute } from "@/lib/db";

/** Create an attribute (dimension). Body: { name: string, multi?: boolean }. Admin only. */
export async function POST(req: Request) {
  const sb = await requireAdmin();
  if (sb instanceof NextResponse) return sb;
  try {
    const { name, multi } = await req.json();
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    await createAttribute(name, multi === true, sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Delete an attribute (cascades its values + assignments). Body: { id: string }. Admin only. */
export async function DELETE(req: Request) {
  const sb = await requireAdmin();
  if (sb instanceof NextResponse) return sb;
  try {
    const { id } = await req.json();
    if (typeof id !== "string" || !id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await deleteAttribute(id, sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
