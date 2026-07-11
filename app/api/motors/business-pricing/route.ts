import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { setBusinessPricing } from "@/lib/db";

/**
 * Authorize (or revoke) a retailer for the shared Business price tier. Admin only.
 * Body: { retailerId, enabled }  (enabled=false puts the customer back on Default pricing)
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const { retailerId, enabled } = await req.json();
    if (typeof retailerId !== "string" || !retailerId) {
      return NextResponse.json({ error: "retailerId required" }, { status: 400 });
    }
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    await setBusinessPricing(retailerId, enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
