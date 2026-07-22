import { NextResponse } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/api";
import { refundOrderLines, type ExchangeReplacementInput, type RefundLineInput } from "@/lib/db";

const BUCKET = "payment-proofs";
const MAX_BYTES = 10 * 1024 * 1024;
const allowed = (type: string) => type.startsWith("image/") || type === "application/pdf";

/**
 * Admin issues a partial (or full) refund on a paid order, optionally with an exchange: a chosen
 * quantity of chosen lines is returned, and any replacement accessories are shipped in the same
 * order. A reason and at least one supporting document (image/PDF) are required. Cash refunded is
 * max(0, returned − replacement) — see refundOrderLines. Fully returning every line closes the
 * order as `refunded`; otherwise it becomes `partially_refunded`.
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

    // Returned lines + optional exchange replacements arrive as JSON strings alongside the files.
    let returns: RefundLineInput[];
    let replacements: ExchangeReplacementInput[];
    try {
      returns = JSON.parse(String(form.get("returns") ?? "[]"));
      replacements = JSON.parse(String(form.get("replacements") ?? "[]"));
    } catch {
      return NextResponse.json({ error: "Malformed refund payload" }, { status: 400 });
    }
    if (!Array.isArray(returns) || !returns.length) {
      return NextResponse.json({ error: "Select at least one line to refund" }, { status: 400 });
    }
    if (!Array.isArray(replacements)) replacements = [];
    const restock = String(form.get("restock") ?? "") === "true";

    // At least one supporting document is required for every refund (partial or full).
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) {
      return NextResponse.json({ error: "At least one supporting document is required" }, { status: 400 });
    }
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

    const result = await refundOrderLines(id, { reason, docPaths, returns, replacements, restock });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
