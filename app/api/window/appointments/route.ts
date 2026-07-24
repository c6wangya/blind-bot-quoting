import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { createWindowAppointment, getDefaultOrgId, listWindowAppointments, updateWindowAppointment } from "@/lib/db";

/** Appointments (optionally per lead). Admin only. */
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const url = new URL(req.url);
    const leadId = url.searchParams.get("leadId");
    const orgId = await getDefaultOrgId();
    return NextResponse.json(
      await listWindowAppointments(orgId, {
        leadId: leadId ? Number(leadId) : undefined,
      })
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * { leadId, kind, scheduledAt, durationMin?, assignee?, notes? }   → create (201)
 * { id, status? | scheduledAt? | assignee? | notes? }              → update
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json();
    const orgId = await getDefaultOrgId();

    if (Number.isInteger(body.id)) {
      if (body.status !== undefined && !["scheduled", "completed", "cancelled"].includes(body.status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
      }
      const appt = await updateWindowAppointment(orgId, body.id, {
        status: body.status,
        scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : undefined,
        assignee: typeof body.assignee === "string" ? body.assignee : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
      });
      return NextResponse.json(appt);
    }

    if (!Number.isInteger(body.leadId) || !["measure", "install", "repair"].includes(body.kind)) {
      return NextResponse.json({ error: "leadId and kind are required" }, { status: 400 });
    }
    const scheduledAt = new Date(body.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: "scheduledAt must be a valid date/time" }, { status: 400 });
    }
    const appt = await createWindowAppointment(orgId, {
      leadId: body.leadId,
      kind: body.kind,
      scheduledAt: scheduledAt.toISOString(),
      durationMin: Number.isInteger(body.durationMin) ? body.durationMin : undefined,
      assignee: typeof body.assignee === "string" ? body.assignee.trim() || undefined : undefined,
      notes: typeof body.notes === "string" ? body.notes.trim() || undefined : undefined,
    });
    return NextResponse.json(appt, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
