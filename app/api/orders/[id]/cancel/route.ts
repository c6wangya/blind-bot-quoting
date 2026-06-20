import { NextResponse } from "next/server";
import { requireOrderAccess } from "@/lib/auth/api";
import { isAdmin } from "@/lib/auth/user";
import { cancelOrder } from "@/lib/db";

/** Cancel an unpaid order (retailer's own, or admin) — releases stock + reopens the quote. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrderAccess(ctx);
  if (gate instanceof NextResponse) return gate;
  const { id, uid } = gate;
  try {
    const result = await cancelOrder(id, (await isAdmin(uid)) ? "system" : "retailer");
    return NextResponse.json({ ok: true, quoteId: result.quoteId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
