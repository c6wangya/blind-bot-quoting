import { NextResponse } from "next/server";
import { userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import { createAddress, listAddresses, sanitizeQuoteDetails } from "@/lib/db";

/**
 * The owner_id addresses belong to, plus the client to use — mirrors app/api/quotes/route.ts.
 * While an admin acts on behalf of a retailer, ownership is the retailer (service_role); otherwise
 * the JWT client so RLS scopes rows to auth.uid().
 */
async function ownerAndClient() {
  const ctx = await getActingContext();
  if (!ctx.realUid) return null;
  const ownerId = ctx.actingAsId ?? ctx.realUid;
  const sb = ctx.actingAsId ? admin() : await userClient();
  return { ownerId, sb };
}

/** The effective owner's saved address book. */
export async function GET() {
  const ctx = await ownerAndClient();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const addresses = await listAddresses(ctx.ownerId, ctx.sb);
  return NextResponse.json({ addresses });
}

/** Create an address. Body: QuoteDetails + { label?, isDefault? }. */
export async function POST(req: Request) {
  const ctx = await ownerAndClient();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const details = sanitizeQuoteDetails(body);
    const label = typeof body.label === "string" ? body.label : null;
    const isDefault = body.isDefault === true;
    const address = await createAddress(ctx.ownerId, details, label, isDefault, ctx.sb);
    return NextResponse.json({ address });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
