import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { setBuyerInfo, type BuyerInfo } from "@/lib/db";

/** Save the buyer block (our purchasing company) printed on every purchase order. Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const b = await req.json();
    const info: BuyerInfo = {
      name: String(b.name ?? "").trim(),
      attn: String(b.attn ?? "").trim(),
      addressLines: Array.isArray(b.addressLines)
        ? b.addressLines.map((l: unknown) => String(l).trim()).filter(Boolean)
        : [],
      tel: String(b.tel ?? "").trim(),
      email: String(b.email ?? "").trim(),
    };
    await setBuyerInfo(info);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
