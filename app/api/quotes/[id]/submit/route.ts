import { NextResponse } from "next/server";
import { canAccessOwned, getCurrentUserId } from "@/lib/auth/user";
import { getQuoteOwnerId, submitPreOrder } from "@/lib/db";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const uid = await getCurrentUserId();
    if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessOwned(uid, await getQuoteOwnerId(Number(id))))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const order = await submitPreOrder(Number(id));
    return NextResponse.json({ order });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
