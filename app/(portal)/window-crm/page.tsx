import { requireAdminPage } from "@/lib/auth/user";
import { getDefaultOrgId, listWindowAppointments, listWindowLeads } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import WindowCrmBoard from "@/components/WindowCrmBoard";

export const dynamic = "force-dynamic";

/** Window ERP — retail CRM board (leads funnel + measure/install scheduling). Admin only. */
export default async function WindowCrmPage() {
  await requireAdminPage("/window-crm");

  let leads: Awaited<ReturnType<typeof listWindowLeads>> = [];
  let upcoming: Awaited<ReturnType<typeof listWindowAppointments>> = [];
  let setupHint: string | null = null;
  try {
    const orgId = await getDefaultOrgId();
    [leads, upcoming] = await Promise.all([
      listWindowLeads(orgId),
      listWindowAppointments(orgId, { upcomingOnly: true }),
    ]);
  } catch (err) {
    setupHint = (err as Error).message; // migration 0053 not applied yet
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="CRM"
        description="Leads through measure, quote, and install — the retail funnel for window coverings."
      />
      {setupHint ? (
        <Card className="p-6">
          <div className="text-sm font-semibold text-ink">Setup required</div>
          <p className="mt-2 text-sm text-ink-soft">
            Run migration <code className="rounded bg-black/5 px-1">supabase/migrations/0053_window_crm.sql</code> in
            the Supabase SQL editor.
          </p>
          <p className="mt-2 text-xs text-muted">{setupHint}</p>
        </Card>
      ) : (
        <WindowCrmBoard initialLeads={leads} initialUpcoming={upcoming} />
      )}
    </div>
  );
}
