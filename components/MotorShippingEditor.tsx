"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ShippingMode } from "@/lib/shipping";
import { useToast } from "./Toast";
import { Card, cx, Spinner } from "./ui";

export type ShippingRow = {
  modelId: string;
  name: string;
  sku: string;
  category: string;
  mode: ShippingMode;
  ground: number;
  expedite: number;
};

type RatePayload = { modelId: string; mode: ShippingMode; ground: number; expedite: number };

// Shared grid + input widths so the "Save all" header sits above the columns.
const GRID = "grid grid-cols-[1fr_150px_120px_120px] gap-3 px-5";

const post = async (rates: RatePayload[]) => {
  const r = await fetch("/api/motors/shipping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rates }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
};

const num = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};

/** Admin: per-motor made-in mode (FOB / US Ground) + US ground/expedite rates (USD/unit). */
export function MotorShippingEditor({ rows }: { rows: ShippingRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Edited values live here so "Save all" submits them together. Keyed `${modelId}:g|e`.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.flatMap((r) => [[`${r.modelId}:g`, String(r.ground)], [`${r.modelId}:e`, String(r.expedite)]]))
  );
  const [modes, setModes] = useState<Record<string, ShippingMode>>(() =>
    Object.fromEntries(rows.map((r) => [r.modelId, r.mode]))
  );
  const setValue = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));
  const setMode = (id: string, m: ShippingMode) => setModes((prev) => ({ ...prev, [id]: m }));

  // Baseline each row is diffed against. Seeded from props, updated optimistically on save so the
  // button settles to "nothing to save" without a flash of the enabled state during router.refresh().
  const seed = () => Object.fromEntries(rows.map((r) => [r.modelId, { ground: r.ground, expedite: r.expedite, mode: r.mode }]));
  const [baseline, setBaseline] = useState<Record<string, { ground: number; expedite: number; mode: ShippingMode }>>(seed);
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setBaseline(seed());
    setModes(Object.fromEntries(rows.map((r) => [r.modelId, r.mode])));
  }

  // A row is "changed" when mode or either (valid) input differs from the stored value.
  const changed = rows.filter((r) => {
    const g = num(values[`${r.modelId}:g`] ?? "");
    const e = num(values[`${r.modelId}:e`] ?? "");
    if (Number.isNaN(g) || Number.isNaN(e)) return false; // invalid → not savable
    const b = baseline[r.modelId] ?? { ground: r.ground, expedite: r.expedite, mode: r.mode };
    return g !== b.ground || e !== b.expedite || (modes[r.modelId] ?? r.mode) !== b.mode;
  });
  const canSave = !busy && changed.length > 0;

  const saveAll = async () => {
    if (changed.length === 0) return;
    setBusy(true);
    try {
      const payload: RatePayload[] = changed.map((r) => ({
        modelId: r.modelId,
        mode: modes[r.modelId] ?? r.mode,
        ground: num(values[`${r.modelId}:g`] ?? ""),
        expedite: num(values[`${r.modelId}:e`] ?? ""),
      }));
      await post(payload);
      setBaseline((b) => {
        const next = { ...b };
        for (const p of payload) next[p.modelId] = { ground: p.ground, expedite: p.expedite, mode: p.mode };
        return next;
      });
      toast(`Saved ${changed.length} motor${changed.length === 1 ? "" : "s"}`);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div
        className={`${GRID} items-center border-b border-line bg-[#fafaf7] py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted`}
      >
        <div className="flex items-center justify-between">
          <span>Motor</span>
          <button
            onClick={saveAll}
            disabled={!canSave}
            className={`mr-3 normal-case ${
              busy ? "text-brass" : canSave ? "text-brass hover:underline" : "cursor-default text-muted opacity-50"
            }`}
          >
            {busy ? (
              <span className="inline-flex items-center justify-center gap-1.5">
                <Spinner /> Saving…
              </span>
            ) : changed.length > 0 ? (
              `Save all (${changed.length})`
            ) : (
              "Save all"
            )}
          </button>
        </div>
        <span>Made in / Mode</span>
        <span>Ground $/unit</span>
        <span>Expedite $/unit</span>
      </div>
      <ul className="divide-y divide-line/70">
        {rows.map((r) => {
          const mode = modes[r.modelId] ?? r.mode;
          const isGround = mode === "ground";
          return (
            <li key={r.modelId} className={`${GRID} items-center py-3`}>
              <div className="min-w-0">
                <div className="truncate text-[13.5px] font-semibold text-ink">{r.name}</div>
                <div className="truncate text-[11px] text-muted">
                  {r.category} · <span className="font-mono">{r.sku}</span>
                </div>
              </div>
              <ModeToggle mode={mode} onChange={(m) => setMode(r.modelId, m)} />
              <RateInput value={values[`${r.modelId}:g`] ?? ""} onChange={(v) => setValue(`${r.modelId}:g`, v)} dim={!isGround} />
              <RateInput value={values[`${r.modelId}:e`] ?? ""} onChange={(v) => setValue(`${r.modelId}:e`, v)} dim={!isGround} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ModeToggle({ mode, onChange }: { mode: ShippingMode; onChange: (m: ShippingMode) => void }) {
  return (
    <div className="inline-flex w-fit rounded-lg border border-line bg-surface p-0.5 text-[11.5px] font-medium">
      {(["fob", "ground"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => mode !== m && onChange(m)}
          className={cx(
            "rounded-md px-2 py-1 transition-colors",
            mode === m ? "bg-ink text-white" : "text-ink-soft hover:bg-[#faf9f5]"
          )}
        >
          {m === "fob" ? "FOB" : "US Ground"}
        </button>
      ))}
    </div>
  );
}

function RateInput({ value, onChange, dim }: { value: string; onChange: (v: string) => void; dim?: boolean }) {
  return (
    <div
      className={cx("flex items-center rounded-lg border border-line bg-surface px-2", dim && "opacity-50")}
      title={dim ? "Only charged when this motor ships US Ground" : undefined}
    >
      <span className="text-xs text-muted">$</span>
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 bg-transparent px-1 py-1.5 text-sm text-ink outline-none"
      />
    </div>
  );
}
