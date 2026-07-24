import { NextResponse } from "next/server";
import { getCurrentUserId, canAccessOwned } from "@/lib/auth/user";
import { getDefaultOrgId, getQuoteOwnerId, listFreightRules, setWindowShipMethod } from "@/lib/db";

/** Set a quote's window ship method (ground / will_call / any org freight method).
 *  Owner or admin; only meaningful while the quote is a draft (submit reads it). */
export async function POST(req: Request) {
  const uid = await getCurrentUserId();
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as { quoteId?: number; method?: string };
    const quoteId = Number(body.quoteId);
    const method = String(body.method ?? "");
    if (!Number.isInteger(quoteId) || !method) {
      return NextResponse.json({ error: "quoteId and method are required" }, { status: 400 });
    }
    if (!(await canAccessOwned(uid, await getQuoteOwnerId(quoteId)))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rules = await listFreightRules(await getDefaultOrgId());
    if (!rules.some((r) => r.method === method)) {
      return NextResponse.json({ error: `Unknown ship method "${method}"` }, { status: 400 });
    }
    await setWindowShipMethod(quoteId, method);
    return NextResponse.json({ ok: true, method });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
