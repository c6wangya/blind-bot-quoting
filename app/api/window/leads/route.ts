import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { createWindowLead, getDefaultOrgId, listWindowAppointments, listWindowLeads } from "@/lib/db";

/** Leads + upcoming appointments (the CRM board's data). Admin only. */
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const orgId = await getDefaultOrgId();
    const [leads, upcoming] = await Promise.all([
      listWindowLeads(orgId),
      listWindowAppointments(orgId, { upcomingOnly: true }),
    ]);
    return NextResponse.json({ leads, upcoming });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Create a lead. Body: { name, phone?, email?, address?, city?, state?, zip?, source?, assignee?, notes? } */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const orgId = await getDefaultOrgId();
    const lead = await createWindowLead(orgId, {
      name,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      address: body.address?.trim() || null,
      city: body.city?.trim() || null,
      state: body.state?.trim() || null,
      zip: body.zip?.trim() || null,
      source: body.source?.trim() || null,
      assignee: body.assignee?.trim() || null,
      notes: body.notes?.trim() || null,
    });
    return NextResponse.json(lead, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
