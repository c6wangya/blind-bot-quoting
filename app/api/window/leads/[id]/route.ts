import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { getDefaultOrgId, LEAD_STATUSES, updateWindowLead } from "@/lib/db";
import type { LeadStatus } from "@/lib/db";

/** PATCH a lead — merge semantics, returns the full row. Admin only. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = await req.json();
    if (body.status !== undefined && !LEAD_STATUSES.includes(body.status as LeadStatus)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    const orgId = await getDefaultOrgId();
    const lead = await updateWindowLead(orgId, id, {
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      phone: body.phone !== undefined ? body.phone?.trim() || null : undefined,
      email: body.email !== undefined ? body.email?.trim() || null : undefined,
      address: body.address !== undefined ? body.address?.trim() || null : undefined,
      city: body.city !== undefined ? body.city?.trim() || null : undefined,
      state: body.state !== undefined ? body.state?.trim() || null : undefined,
      zip: body.zip !== undefined ? body.zip?.trim() || null : undefined,
      source: body.source !== undefined ? body.source?.trim() || null : undefined,
      assignee: body.assignee !== undefined ? body.assignee?.trim() || null : undefined,
      status: body.status,
      notes: body.notes !== undefined ? body.notes?.trim() || null : undefined,
      nextFollowUp: body.nextFollowUp !== undefined ? body.nextFollowUp || null : undefined,
      quoteId: body.quoteId !== undefined ? body.quoteId : undefined,
      details: typeof body.details === "object" && body.details !== null ? body.details : undefined,
    });
    return NextResponse.json(lead);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
