import { NextResponse } from "next/server";
import { userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import { createQuote, getQuotes, sanitizeQuoteDetails } from "@/lib/db";

/**
 * The owner_id new/listed quotes belong to, plus the client to use. While an admin is acting on
 * behalf of a retailer, ownership is the retailer and we use service_role — RLS `quotes_insert`
 * only allows `owner_id = auth.uid()`, so a JWT client can't create a quote for someone else.
 */
async function ownerAndClient() {
  const ctx = await getActingContext();
  if (!ctx.realUid) return null;
  const ownerId = ctx.actingAsId ?? ctx.realUid;
  const sb = ctx.actingAsId ? admin() : await userClient();
  return { ownerId, sb };
}

/** The acting/effective owner's DRAFT quotes — used by the "add to existing quote" chooser. */
export async function GET() {
  const ctx = await ownerAndClient();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const quotes = await getQuotes(ctx.ownerId, ctx.sb);
  const drafts = quotes
    .filter((q) => q.status === "draft")
    .map((q) => ({
      id: q.id,
      ref: q.ref,
      customerName: q.customerName,
      sidemark: q.sidemark,
      projectName: q.projectName,
      itemCount: q.itemCount,
    }));
  return NextResponse.json({ drafts });
}

/** Create a new draft quote with header details. Body: QuoteDetails (all optional). */
export async function POST(req: Request) {
  const ctx = await ownerAndClient();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const details = sanitizeQuoteDetails(await req.json().catch(() => ({})));
    const quote = await createQuote(ctx.ownerId, details, ctx.sb);
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
