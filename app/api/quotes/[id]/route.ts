import { NextResponse } from "next/server";
import { canAccessOwned, getCurrentUserId, userClient } from "@/lib/auth/user";
import { deleteQuote, getQuote, getQuoteOwnerId } from "@/lib/db";

/** Delete a draft quote (and its items). Only the owner/admin, and only while it's a draft. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const uid = await getCurrentUserId();
    if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canAccessOwned(uid, await getQuoteOwnerId(Number(id))))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const sb = await userClient();
    const quote = await getQuote(Number(id), sb);
    if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (quote.status !== "draft") {
      return NextResponse.json({ error: "Only draft quotes can be deleted" }, { status: 400 });
    }
    await deleteQuote(Number(id), sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
