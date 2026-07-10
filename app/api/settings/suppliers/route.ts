import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { setSupplierInfo, type SupplierInfo } from "@/lib/db";

/** Save one brand's supplier profile (company header + bank details) for its purchase orders. Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const b = await req.json();
    const brandId = String(b.brandId ?? "").trim();
    if (!brandId) return NextResponse.json({ error: "Missing brandId" }, { status: 400 });
    const info: SupplierInfo = {
      name: String(b.name ?? "").trim(),
      addressLines: Array.isArray(b.addressLines)
        ? b.addressLines.map((l: unknown) => String(l).trim()).filter(Boolean)
        : [],
      tel: String(b.tel ?? "").trim(),
      fax: String(b.fax ?? "").trim(),
      website: String(b.website ?? "").trim(),
      bankName: String(b.bankName ?? "").trim(),
      swift: String(b.swift ?? "").trim(),
      beneficiary: String(b.beneficiary ?? "").trim(),
      accountNumber: String(b.accountNumber ?? "").trim(),
      bankAddress: String(b.bankAddress ?? "").trim(),
    };
    await setSupplierInfo(brandId, info);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
