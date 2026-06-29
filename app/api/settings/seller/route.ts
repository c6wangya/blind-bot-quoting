import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { setSellerInfo, type SellerInfo } from "@/lib/db";

/** Save the seller / ship-from block printed on invoices & purchase orders. Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const b = await req.json();
    const info: SellerInfo = {
      name: String(b.name ?? "").trim(),
      addressLines: Array.isArray(b.addressLines)
        ? b.addressLines.map((l: unknown) => String(l).trim()).filter(Boolean)
        : [],
      taxId: String(b.taxId ?? "").trim(),
    };
    await setSellerInfo(info);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
