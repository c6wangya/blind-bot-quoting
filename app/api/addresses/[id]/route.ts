import { NextResponse } from "next/server";
import { userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import { deleteAddress, sanitizeQuoteDetails, setDefaultAddress, updateAddress } from "@/lib/db";

async function ownerAndClient() {
  const ctx = await getActingContext();
  if (!ctx.realUid) return null;
  const ownerId = ctx.actingAsId ?? ctx.realUid;
  const sb = ctx.actingAsId ? admin() : await userClient();
  return { ownerId, sb };
}

/** Update an address, or just flip its default. Body: QuoteDetails + { label?, isDefault? }
 *  — or { setDefault: true } to only mark it default. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await ownerAndClient();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.setDefault === true) {
      await setDefaultAddress(id, ctx.ownerId, ctx.sb);
      return NextResponse.json({ ok: true });
    }
    const details = sanitizeQuoteDetails(body);
    const label = typeof body.label === "string" ? body.label : null;
    const isDefault = body.isDefault === true;
    await updateAddress(id, ctx.ownerId, details, label, isDefault, ctx.sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await ownerAndClient();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    await deleteAddress(id, ctx.ownerId, ctx.sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
