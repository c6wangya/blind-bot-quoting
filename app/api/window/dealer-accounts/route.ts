import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import {
  createDealerAccount,
  getDefaultOrgId,
  listAccountFactors,
  listDealerAccounts,
  setAccountFactor,
} from "@/lib/db";

/** Dealer companies + their live pricing factors. Admin only. */
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const orgId = await getDefaultOrgId();
    const accounts = await listDealerAccounts(orgId);
    const factors = await Promise.all(accounts.map((a) => listAccountFactors(a.id)));
    return NextResponse.json(accounts.map((a, i) => ({ ...a, factors: factors[i] })));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * { name, contact?, qbRef? }                               → create a dealer account (201)
 * { dealerAccountId, factor, productId? | lineKey? }       → set a factor at one scope
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json();
    const orgId = await getDefaultOrgId();

    if (Number.isInteger(body.dealerAccountId) && body.factor !== undefined) {
      const factor = Number(body.factor);
      if (!Number.isFinite(factor) || factor <= 0 || factor > 10) {
        return NextResponse.json({ error: "factor must be a positive number" }, { status: 400 });
      }
      const row = await setAccountFactor(orgId, {
        dealerAccountId: body.dealerAccountId,
        productId: Number.isInteger(body.productId) ? body.productId : null,
        lineKey: typeof body.lineKey === "string" && body.lineKey ? body.lineKey : null,
        factor,
      });
      return NextResponse.json(row, { status: 201 });
    }

    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const account = await createDealerAccount(orgId, {
      name,
      contact: typeof body.contact === "object" && body.contact ? body.contact : undefined,
      qbRef: typeof body.qbRef === "string" ? body.qbRef : undefined,
    });
    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
