"use client";

import { useMemo, useState } from "react";
import type { DeductionComponent, DeductionRow, PartRule } from "@/lib/window/production";
import { Badge, Button, Card, Input, Select, cx } from "./ui";

// Admin editor for manufacturing deduction rules — the factory's process knowledge, editable
// by the factory (the anchor customer re-tunes these monthly and tracks changes in hand-kept
// Log sheets; here every save is an effective-dated revision, history preserved automatically).

type Props = { initialRows: DeductionRow[]; lineKeys: string[] };

export default function WindowDeductionsAdmin({ initialRows, lineKeys }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [lineKey, setLineKey] = useState(lineKeys[0] ?? "roller_shade");
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => rows.filter((r) => r.lineKey === lineKey), [rows, lineKey]);

  async function post(body: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/window/deductions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    if (!res.ok) {
      setError(out.error ?? "Action failed");
      throw new Error(out.error);
    }
    return out;
  }

  async function refresh() {
    const res = await fetch("/api/window/deductions");
    if (res.ok) setRows(await res.json());
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <Select value={lineKey} onChange={(e) => setLineKey(e.target.value)} className="w-56">
          {lineKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted">
          Cut = dimension × multiplier + offset · every save is a dated revision (history kept)
        </span>
      </div>
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {visible.map((row) => (
        <RuleCard key={row.id} row={row} onPost={post} onDone={refresh} />
      ))}
      {visible.length === 0 && (
        <Card className="p-5 text-sm text-muted">No deduction rules for this line yet.</Card>
      )}
    </div>
  );
}

function RuleCard({
  row,
  onPost,
  onDone,
}: {
  row: DeductionRow;
  onPost: (b: Record<string, unknown>) => Promise<unknown>;
  onDone: () => Promise<void>;
}) {
  // Draft state: string-typed offsets/multipliers so partial input never fights the user.
  const [draft, setDraft] = useState<Record<string, { offset: string; multiplier: string }>>({});
  const [partsDraft, setPartsDraft] = useState<Record<number, string>>({}); // part idx -> bands text
  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(draft).length > 0 || Object.keys(partsDraft).length > 0;

  const val = (key: string, c: DeductionComponent) => ({
    offset: draft[key]?.offset ?? String(c.offset),
    multiplier: draft[key]?.multiplier ?? String(c.multiplier ?? 1),
  });

  async function save() {
    setSaving(true);
    try {
      const components: Record<string, DeductionComponent> = {};
      for (const [key, c] of Object.entries(row.components)) {
        const v = val(key, c);
        const offset = Number(v.offset);
        const multiplier = Number(v.multiplier);
        if (!Number.isFinite(offset) || !Number.isFinite(multiplier) || multiplier <= 0) {
          throw new Error(`Invalid numbers for "${c.label}"`);
        }
        components[key] = { ...c, offset, ...(multiplier !== 1 ? { multiplier } : {}) };
      }
      let parts: PartRule[] | undefined;
      if (Object.keys(partsDraft).length > 0) {
        parts = (row.parts ?? []).map((p, i) => {
          const text = partsDraft[i];
          if (text === undefined || p.qtyRule.kind !== "width_band") return p;
          const pairs = text
            .split(/[,;]/)
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => x.split(":").map(Number));
          if (pairs.some((pr) => pr.length !== 2 || pr.some((n) => !Number.isFinite(n)))) {
            throw new Error(`Invalid bands for "${p.label}" — use "60:2, 96:3, 200:4"`);
          }
          return { ...p, qtyRule: { kind: "width_band" as const, breaks: pairs.map((x) => x[0]), values: pairs.map((x) => x[1]) } };
        });
      }
      await onPost({ action: "revise", id: row.id, components, ...(parts ? { parts } : {}) });
      setDraft({});
      setPartsDraft({});
      await onDone();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-ink">{row.label}</div>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {row.matcher.map((m, i) => (
              <Badge key={i} className="border-line bg-black/[.03] text-ink-soft">
                {m.fieldKey}
                {m.valueToken ? ` = ${m.valueToken}` : m.anyOf ? ` ∈ {${m.anyOf.join(", ")}}` : m.truthy ? " on" : ""}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save revision"}
            </Button>
          )}
          <button
            className="text-xs font-medium text-red-500 hover:text-red-700"
            onClick={async () => {
              if (!confirm(`Retire rule "${row.label}"? Existing orders keep their snapshots.`)) return;
              await onPost({ action: "remove", id: row.id });
              await onDone();
            }}
          >
            Retire
          </button>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-4 font-semibold">Component</th>
              <th className="py-1 pr-4 font-semibold">Base</th>
              <th className="py-1 pr-4 font-semibold">× Multiplier</th>
              <th className="py-1 font-semibold">+ Offset (in)</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(row.components).map(([key, c]) => {
              const v = val(key, c);
              const changed = key in draft;
              return (
                <tr key={key} className={cx("border-t border-line/50", changed && "bg-amber-50/50")}>
                  <td className="py-1.5 pr-4 font-medium text-ink">{c.label}</td>
                  <td className="py-1.5 pr-4 text-xs text-muted">{c.base}</td>
                  <td className="py-1.5 pr-4">
                    <Input
                      value={v.multiplier}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: { ...v, multiplier: e.target.value } }))}
                      className="w-20 text-xs"
                    />
                  </td>
                  <td className="py-1.5">
                    <Input
                      value={v.offset}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: { ...v, offset: e.target.value } }))}
                      className="w-24 text-xs"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(row.parts ?? []).length > 0 && (
        <div className="mt-3 border-t border-line/50 pt-3">
          <div className="text-xs font-semibold text-ink-soft">Hardware</div>
          <div className="mt-1.5 space-y-1.5">
            {(row.parts ?? []).map((p, i) => (
              <div key={p.key} className="flex items-center gap-3 text-xs">
                <span className="w-32 font-medium text-ink">{p.label}</span>
                {p.qtyRule.kind === "per_unit" ? (
                  <span className="text-muted">{p.qtyRule.value} per unit</span>
                ) : (
                  <>
                    <span className="text-muted">by width band (≤break:qty)</span>
                    <Input
                      value={
                        partsDraft[i] ??
                        p.qtyRule.breaks.map((b, j) => `${b}:${(p.qtyRule as { values: number[] }).values[j]}`).join(", ")
                      }
                      onChange={(e) => setPartsDraft((d) => ({ ...d, [i]: e.target.value }))}
                      className="w-56 text-xs"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {row.note && <div className="mt-2 text-[11px] italic text-muted">{row.note}</div>}
    </Card>
  );
}
