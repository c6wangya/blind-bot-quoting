import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";

// Phase C (first slice) — retail CRM: leads + appointments. Back-office only; reads/writes go
// through the service role behind admin-gated routes (RLS is admin-only as backstop).

export type LeadStatus = "new" | "contacted" | "measure_scheduled" | "quoted" | "won" | "lost";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "measure_scheduled", "quoted", "won", "lost"];

export type WindowLead = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  source?: string | null;
  assignee?: string | null;
  status: LeadStatus;
  details: Record<string, unknown>; // gate codes, preferred language, competitor… (MF fields)
  notes?: string | null;
  nextFollowUp?: string | null; // date
  quoteId?: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentKind = "measure" | "install" | "repair";
export type WindowAppointment = {
  id: number;
  leadId: number;
  kind: AppointmentKind;
  scheduledAt: string;
  durationMin: number;
  assignee?: string | null;
  status: "scheduled" | "completed" | "cancelled";
  notes?: string | null;
  createdAt: string;
};

const LEAD_COLS =
  "id, name, phone, email, address, city, state, zip, source, assignee, status, details, notes, " +
  "nextFollowUp:next_follow_up, quoteId:quote_id, createdAt:created_at, updatedAt:updated_at";
const APPT_COLS =
  "id, leadId:lead_id, kind, scheduledAt:scheduled_at, durationMin:duration_min, assignee, status, notes, createdAt:created_at";

export async function listWindowLeads(orgId: number, client: SupabaseClient = admin()): Promise<WindowLead[]> {
  const { data, error } = await client
    .from("window_leads")
    .select(LEAD_COLS)
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as WindowLead[];
}

export async function createWindowLead(
  orgId: number,
  lead: Partial<WindowLead> & { name: string },
  client: SupabaseClient = admin()
): Promise<WindowLead> {
  const { data, error } = await client
    .from("window_leads")
    .insert({
      org_id: orgId,
      name: lead.name,
      phone: lead.phone ?? null,
      email: lead.email ?? null,
      address: lead.address ?? null,
      city: lead.city ?? null,
      state: lead.state ?? null,
      zip: lead.zip ?? null,
      source: lead.source ?? null,
      assignee: lead.assignee ?? null,
      status: lead.status ?? "new",
      details: lead.details ?? {},
      notes: lead.notes ?? null,
      next_follow_up: lead.nextFollowUp ?? null,
    })
    .select(LEAD_COLS)
    .single();
  if (error) throw error;
  return data as unknown as WindowLead;
}

export async function updateWindowLead(
  orgId: number,
  id: number,
  patch: Partial<WindowLead>,
  client: SupabaseClient = admin()
): Promise<WindowLead> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [from, to] of [
    ["name", "name"], ["phone", "phone"], ["email", "email"], ["address", "address"],
    ["city", "city"], ["state", "state"], ["zip", "zip"], ["source", "source"],
    ["assignee", "assignee"], ["status", "status"], ["details", "details"], ["notes", "notes"],
    ["nextFollowUp", "next_follow_up"], ["quoteId", "quote_id"],
  ] as const) {
    if (patch[from] !== undefined) row[to] = patch[from];
  }
  const { data, error } = await client
    .from("window_leads")
    .update(row)
    .eq("id", id)
    .eq("org_id", orgId)
    .select(LEAD_COLS)
    .single();
  if (error) throw error;
  return data as unknown as WindowLead;
}

export async function listWindowAppointments(
  orgId: number,
  opts: { leadId?: number; upcomingOnly?: boolean } = {},
  client: SupabaseClient = admin()
): Promise<WindowAppointment[]> {
  let q = client.from("window_appointments").select(APPT_COLS).eq("org_id", orgId);
  if (opts.leadId != null) q = q.eq("lead_id", opts.leadId);
  if (opts.upcomingOnly) q = q.eq("status", "scheduled").gte("scheduled_at", new Date().toISOString());
  const { data, error } = await q.order("scheduled_at");
  if (error) throw error;
  return (data ?? []) as unknown as WindowAppointment[];
}

export async function createWindowAppointment(
  orgId: number,
  appt: { leadId: number; kind: AppointmentKind; scheduledAt: string; durationMin?: number; assignee?: string; notes?: string },
  client: SupabaseClient = admin()
): Promise<WindowAppointment> {
  const { data, error } = await client
    .from("window_appointments")
    .insert({
      org_id: orgId,
      lead_id: appt.leadId,
      kind: appt.kind,
      scheduled_at: appt.scheduledAt,
      duration_min: appt.durationMin ?? 60,
      assignee: appt.assignee ?? null,
      notes: appt.notes ?? null,
    })
    .select(APPT_COLS)
    .single();
  if (error) throw error;
  // A freshly scheduled measure pulls a new/contacted lead forward in the funnel.
  if (appt.kind === "measure") {
    await client
      .from("window_leads")
      .update({ status: "measure_scheduled", updated_at: new Date().toISOString() })
      .eq("id", appt.leadId)
      .eq("org_id", orgId)
      .in("status", ["new", "contacted"]);
  }
  return data as unknown as WindowAppointment;
}

export async function updateWindowAppointment(
  orgId: number,
  id: number,
  patch: { status?: WindowAppointment["status"]; scheduledAt?: string; assignee?: string; notes?: string },
  client: SupabaseClient = admin()
): Promise<WindowAppointment> {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.scheduledAt !== undefined) row.scheduled_at = patch.scheduledAt;
  if (patch.assignee !== undefined) row.assignee = patch.assignee;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { data, error } = await client
    .from("window_appointments")
    .update(row)
    .eq("id", id)
    .eq("org_id", orgId)
    .select(APPT_COLS)
    .single();
  if (error) throw error;
  return data as unknown as WindowAppointment;
}
