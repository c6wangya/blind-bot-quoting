import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/api";
import { refundOrder } from "@/lib/db";

const BUCKET = "payment-proofs";
const MAX_BYTES = 10 * 1024 * 1024;
const allowed = (type: string) => type.startsWith("image/") || type === "application/pdf";

/**
 * Admin issues a FULL refund on a paid, pre-shipment order. A reason is required; a supporting
 * document (image/PDF receipt, photo of a defect, etc.) is optional and stored in the private
 * payment-proofs bucket. Moves the order to the terminal `refunded` status (see refundOrder).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const form = await req.formData();
    const reason = String(form.get("reason") ?? "").trim().slice(0, 2000);
    if (!reason) return NextResponse.json({ error: "A refund reason is required" }, { status: 400 });

    // Multiple supporting documents (optional). Each is validated then uploaded to the private bucket.
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    const docPaths: string[] = [];
    for (const file of files) {
      if (!allowed(file.type)) return NextResponse.json({ error: `"${file.name}" must be an image or PDF` }, { status: 400 });
      if (file.size > MAX_BYTES) return NextResponse.json({ error: `"${file.name}" must be ≤ 10 MB` }, { status: 400 });
      const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
      const path = `orders/${id}/refund-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await admin().storage.from(BUCKET).upload(path, file, { contentType: file.type });
      if (upErr) {
        const msg = /bucket/i.test(upErr.message)
          ? `Storage bucket "${BUCKET}" not found — create it (private) in Supabase first.`
          : upErr.message;
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      docPaths.push(path);
    }

    await refundOrder(id, { reason, docPaths });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
