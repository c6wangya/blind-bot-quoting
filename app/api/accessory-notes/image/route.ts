import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { admin } from "@/lib/supabase/admin";
import { ACCESSORY_BUCKET, addNoteImage, deleteNoteImage } from "@/lib/db";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

/** Upload a note image → store it + attach to the model's note. Multipart: `file` + `modelId`. Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const form = await req.formData();
    const file = form.get("file");
    const modelId = String(form.get("modelId") ?? "").trim();
    if (!modelId) return NextResponse.json({ error: "modelId required" }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Use a PNG/JPEG/WebP/GIF/SVG image" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image must be ≤ 5 MB" }, { status: 400 });

    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `notes/${crypto.randomUUID()}.${ext}`;
    const sb = admin(); // service_role → bypasses storage RLS for the write
    const { error } = await sb.storage.from(ACCESSORY_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) {
      const msg = /bucket/i.test(error.message)
        ? `Storage bucket "${ACCESSORY_BUCKET}" not found — create it (public) in Supabase first.`
        : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const image = await addNoteImage(modelId, path);
    return NextResponse.json(image);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Remove a note image (storage object + row). Body: `{ id }`. Admin only. */
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    await deleteNoteImage(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
