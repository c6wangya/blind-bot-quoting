import { NextResponse } from "next/server";
import { getCurrentUserId, userClient } from "@/lib/auth/user";
import { createQuote, getQuotes, sanitizeQuoteDetails } from "@/lib/db";

/** The signed-in user's DRAFT quotes — used by the "add to existing quote" chooser. */
export async function GET() {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const quotes = await getQuotes(uid, await userClient());
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
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const details = sanitizeQuoteDetails(await req.json().catch(() => ({})));
    const quote = await createQuote(uid, details, await userClient());
    return NextResponse.json({ quote });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
