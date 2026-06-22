import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/api";
import { addModelFile, ACCESSORY_BUCKET, deleteModelFile, type ModelFileKind } from "@/lib/db";

const MAX_BYTES = 15 * 1024 * 1024;
const DOC_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
const allowed = (type: string) => type.startsWith("image/") || DOC_TYPES.includes(type);
const KIND = (k: unknown): ModelFileKind => (k === "spec" || k === "certification" ? k : "other");

/** Upload a per-model attachment (spec / certification / other). Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const modelId = String(form.get("modelId") ?? "");
    const kind = KIND(form.get("kind"));
    if (!modelId) return NextResponse.json({ error: "modelId required" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!allowed(file.type)) return NextResponse.json({ error: "Use an image or PDF/Word/Excel/CSV/TXT file" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be ≤ 15 MB" }, { status: 400 });

    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const path = `docs/${modelId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin().storage.from(ACCESSORY_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      const msg = /bucket/i.test(upErr.message) ? `Storage bucket "${ACCESSORY_BUCKET}" not found.` : upErr.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    await addModelFile(modelId, { name: file.name, path, kind });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Delete a per-model attachment. Admin only. */
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const b = await req.json();
    if (typeof b.id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteModelFile(b.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
