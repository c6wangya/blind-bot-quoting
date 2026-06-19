"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MotorOption } from "@/lib/types";
import { Button, Card } from "./ui";

type Kind = "crown" | "driver";

async function call(method: string, body: unknown): Promise<void> {
  const r = await fetch("/api/motors/crown-driver", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Request failed");
}

/** Admin: manage Crown and Driver versions (label + price delta added to the motor). */
export function CrownDriverEditor({ crown, driver }: { crown: MotorOption[]; driver: MotorOption[] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <OptionList kind="crown" title="Crown versions" options={crown} />
      <OptionList kind="driver" title="Driver versions" options={driver} />
    </div>
  );
}

function OptionList({ kind, title, options }: { kind: Kind; title: string; options: MotorOption[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [delta, setDelta] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!label.trim()) {
      setError("Label required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call("POST", { kind, label, priceDelta: Number(delta) || 0 });
      setLabel("");
      setDelta("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line/70">
          {options.length === 0 && <li className="px-5 py-4 text-[13px] text-muted">No versions yet.</li>}
          {options.map((o) => (
            <Row key={o.id} kind={kind} opt={o} />
          ))}
        </ul>
        <div className="flex items-end gap-2 border-t border-line px-5 py-3">
          <label className="flex-1">
            <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-muted">New version</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. v1"
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
            />
          </label>
          <label className="w-24">
            <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-muted">+$ delta</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
            />
          </label>
          <Button variant="primary" busy={busy} className="py-1.5 text-[12px]" onClick={add}>
            Add
          </Button>
        </div>
        {error && <p className="px-5 pb-3 text-xs text-red-500">{error}</p>}
      </Card>
    </div>
  );
}

function Row({ kind, opt }: { kind: Kind; opt: MotorOption }) {
  const router = useRouter();
  const [label, setLabel] = useState(opt.label);
  const [delta, setDelta] = useState(String(opt.priceDelta));
  const [busy, setBusy] = useState(false);
  const dirty = label !== opt.label || Number(delta) !== opt.priceDelta;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch {
      /* surfaced by re-enabling */
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-2 px-5 py-2.5">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink"
      />
      <div className="flex w-24 items-center rounded-lg border border-line bg-surface px-2">
        <span className="text-xs text-muted">+$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={delta}
          onChange={(e) => setDelta(e.target.value)}
          className="w-full bg-transparent px-1 py-1.5 text-sm text-ink outline-none"
        />
      </div>
      <Button
        variant="primary"
        busy={busy}
        disabled={!dirty}
        className="py-1.5 text-[12px]"
        onClick={() => run(() => call("PATCH", { kind, id: opt.id, label, priceDelta: Number(delta) || 0 }))}
      >
        Save
      </Button>
      <button
        onClick={() => run(() => call("DELETE", { kind, id: opt.id }))}
        disabled={busy}
        className="text-[11px] font-medium text-muted hover:text-red-500"
      >
        Delete
      </button>
    </li>
  );
}
