import { NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/auth/api";
import { setQuoteExpedite } from "@/lib/db";

/**
 * Set a quote's expedite request. Owner (or admin) only, via requireQuoteAccess (RLS).
 * The FOB/Ground mode is per-motor (admin-set) and is NOT customer-editable, so this only
 * carries the expedite flag. Body: { expedite: boolean }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireQuoteAccess(ctx);
  if (gate instanceof NextResponse) return gate;
  const { id, sb } = gate;
  try {
    const body = await req.json().catch(() => ({}));
    await setQuoteExpedite(id, body?.expedite === true, sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
