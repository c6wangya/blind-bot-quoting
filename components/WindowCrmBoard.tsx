"use client";

import { useMemo, useState } from "react";
import type { LeadStatus, WindowAppointment, WindowLead } from "@/lib/db/window-crm";
import { Badge, Button, Card, Input, Select, cx } from "./ui";

// Phase C — CRM board: funnel columns (the MF workbook's sales pipeline), upcoming
// measure/install strip, inline lead detail + appointment scheduling. Admin-only blade.

const STATUS_META: Record<LeadStatus, { label: string; tone: string }> = {
  new: { label: "New", tone: "border-sky-200 bg-sky-50 text-sky-700" },
  contacted: { label: "Contacted", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  measure_scheduled: { label: "Measure Scheduled", tone: "border-amber-200 bg-amber-50 text-amber-700" },
  quoted: { label: "Quoted", tone: "border-purple-200 bg-purple-50 text-purple-700" },
  won: { label: "Won", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  lost: { label: "Lost", tone: "border-line bg-black/5 text-muted" },
};
const ORDER: LeadStatus[] = ["new", "contacted", "measure_scheduled", "quoted", "won", "lost"];

type Props = { initialLeads: WindowLead[]; initialUpcoming: WindowAppointment[] };

export default function WindowCrmBoard({ initialLeads, initialUpcoming }: Props) {
  const [leads, setLeads] = useState(initialLeads);
  const [upcoming, setUpcoming] = useState(initialUpcoming);
  const [openLead, setOpenLead] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byStatus = useMemo(() => {
    const m = new Map<LeadStatus, WindowLead[]>(ORDER.map((s) => [s, []]));
    for (const l of leads) m.get(l.status)?.push(l);
    return m;
  }, [leads]);

  const leadName = (id: number) => leads.find((l) => l.id === id)?.name ?? `lead ${id}`;

  async function refresh() {
    const res = await fetch("/api/window/leads");
    if (res.ok) {
      const out = await res.json();
      setLeads(out.leads);
      setUpcoming(out.upcoming);
    }
  }

  async function patchLead(id: number, patch: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/window/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const out = await res.json();
    if (!res.ok) {
      setError(out.error ?? "Update failed");
      return;
    }
    setLeads((ls) => ls.map((l) => (l.id === id ? out : l)));
  }

  return (
    <div className="mt-4 space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {/* upcoming appointments strip */}
      {upcoming.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Upcoming appointments</div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {upcoming.map((a) => (
              <div key={a.id} className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs">
                <div className="font-semibold text-ink">
                  {a.kind === "measure" ? "📐" : a.kind === "install" ? "🔧" : "🛠"} {leadName(a.leadId)}
                </div>
                <div className="mt-0.5 text-muted">
                  {new Date(a.scheduledAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {a.assignee ? ` · ${a.assignee}` : ""}
                </div>
                <div className="mt-1 flex gap-2">
                  <button
                    className="font-medium text-emerald-600 hover:underline"
                    onClick={async () => {
                      await fetch("/api/window/appointments", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: a.id, status: "completed" }),
                      });
                      await refresh();
                    }}
                  >
                    Done
                  </button>
                  <button
                    className="font-medium text-red-500 hover:underline"
                    onClick={async () => {
                      await fetch("/api/window/appointments", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: a.id, status: "cancelled" }),
                      });
                      await refresh();
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <NewLead onDone={refresh} />

      {/* funnel columns */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ORDER.map((status) => {
          const col = byStatus.get(status) ?? [];
          return (
            <div key={status}>
              <div className="mb-2 flex items-center gap-2">
                <Badge className={STATUS_META[status].tone}>{STATUS_META[status].label}</Badge>
                <span className="text-xs tabular-nums text-muted">{col.length}</span>
              </div>
              <div className="space-y-2">
                {col.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    open={openLead === lead.id}
                    onToggle={() => setOpenLead(openLead === lead.id ? null : lead.id)}
                    onPatch={(p) => patchLead(lead.id, p)}
                    onScheduled={refresh}
                  />
                ))}
                {col.length === 0 && (
                  <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-muted">
                    empty
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewLead({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card className="flex flex-wrap items-end gap-2 p-4">
      <label className="block min-w-44 flex-1">
        <span className="mb-1 block text-xs font-medium text-muted">New lead</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
      </label>
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="w-36" />
      <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source (referral…)" className="w-40" />
      <Button
        disabled={busy || !name.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await fetch("/api/window/leads", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, phone, source }),
            });
            setName("");
            setPhone("");
            setSource("");
            await onDone();
          } finally {
            setBusy(false);
          }
        }}
      >
        Add
      </Button>
    </Card>
  );
}

function LeadCard({
  lead,
  open,
  onToggle,
  onPatch,
  onScheduled,
}: {
  lead: WindowLead;
  open: boolean;
  onToggle: () => void;
  onPatch: (p: Record<string, unknown>) => Promise<void>;
  onScheduled: () => Promise<void>;
}) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [followUp, setFollowUp] = useState(lead.nextFollowUp ?? "");
  const [apptKind, setApptKind] = useState("measure");
  const [apptAt, setApptAt] = useState("");
  const overdue = lead.nextFollowUp && lead.nextFollowUp <= new Date().toISOString().slice(0, 10);

  return (
    <Card className={cx("p-3", open && "ring-1 ring-ink/20")}>
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-ink">{lead.name}</span>
          {overdue && lead.status !== "won" && lead.status !== "lost" && (
            <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9.5px] font-semibold text-red-600">
              follow up
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted">
          {[lead.phone, lead.city, lead.source].filter(Boolean).join(" · ") || "—"}
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-line/60 pt-3">
          <Select value={lead.status} onChange={(e) => onPatch({ status: e.target.value })} className="w-full text-xs">
            {ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </Select>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (lead.notes ?? "") && onPatch({ notes })}
            placeholder="Notes…"
            className="h-16 w-full rounded-lg border border-line bg-white p-2 text-xs"
          />
          <label className="flex items-center gap-2 text-[11px] text-muted">
            Follow up
            <Input
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onBlur={() => followUp !== (lead.nextFollowUp ?? "") && onPatch({ nextFollowUp: followUp || null })}
              className="flex-1 text-xs"
            />
          </label>
          <div className="flex items-center gap-1.5">
            <Select value={apptKind} onChange={(e) => setApptKind(e.target.value)} className="w-24 text-xs">
              <option value="measure">Measure</option>
              <option value="install">Install</option>
              <option value="repair">Repair</option>
            </Select>
            <Input
              type="datetime-local"
              value={apptAt}
              onChange={(e) => setApptAt(e.target.value)}
              className="flex-1 text-xs"
            />
            <Button
              variant="secondary"
              disabled={!apptAt}
              onClick={async () => {
                await fetch("/api/window/appointments", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ leadId: lead.id, kind: apptKind, scheduledAt: apptAt }),
                });
                setApptAt("");
                await onScheduled();
              }}
            >
              Book
            </Button>
          </div>
          {lead.quoteId && (
            <a href={`/quotes/${lead.quoteId}`} className="block text-xs font-medium text-brass hover:underline">
              View quote →
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
