"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { usd } from "@/lib/format";
import { Button, Card } from "./ui";

export type PriceRow = {
  modelId: string;
  name: string;
  sku: string;
  category: string;
  defaultPrice: number;
  currentPrice: number;
  hasOverride: boolean;
};
export type Target = { kind: "default" } | { kind: "retailer"; retailerId: string; label: string };

/** Admin: edit motor prices for the Default tier, or override them for one retailer. */
export function MotorPriceEditor({ target, rows }: { target: Target; rows: PriceRow[] }) {
  const router = useRouter();
  const isRetailer = target.kind === "retailer";
  const [busy, setBusy] = useState(false);

  const resetAll = async () => {
    if (!isRetailer) return;
    setBusy(true);
    await fetch("/api/motors/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retailerId: target.retailerId, reset: true }),
    });
    router.refresh();
    setBusy(false);
  };

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[1fr_120px_180px] gap-3 border-b border-line bg-[#fafaf7] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span>Motor</span>
        <span>{isRetailer ? "Default" : "Price"}</span>
        <span className="flex items-center justify-between">
          {isRetailer ? "This retailer" : ""}
          {isRetailer && (
            <button onClick={resetAll} disabled={busy} className="font-medium normal-case text-brass hover:underline">
              Reset all
            </button>
          )}
        </span>
      </div>
      <ul className="divide-y divide-line/70">
        {rows.map((r) => (
          <Row key={r.modelId} row={r} target={target} />
        ))}
      </ul>
    </Card>
  );
}

function Row({ row, target }: { row: PriceRow; target: Target }) {
  const router = useRouter();
  const isRetailer = target.kind === "retailer";
  const [value, setValue] = useState(String(row.currentPrice));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/motors/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) {
      setError("Enter a valid price");
      return;
    }
    post(isRetailer ? { modelId: row.modelId, retailerId: (target as { retailerId: string }).retailerId, price } : { modelId: row.modelId, price });
  };

  return (
    <li className="grid grid-cols-[1fr_120px_180px] items-center gap-3 px-5 py-3">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-ink">{row.name}</div>
        <div className="truncate text-[11px] text-muted">
          {row.category} · <span className="font-mono">{row.sku}</span>
          {isRetailer && row.hasOverride && <span className="ml-1.5 text-brass">· custom</span>}
        </div>
      </div>
      <div className="text-[13px] tabular-nums text-muted">{usd(row.defaultPrice)}</div>
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center rounded-lg border border-line bg-surface px-2">
          <span className="text-xs text-muted">$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-16 bg-transparent px-1 py-1.5 text-sm text-ink outline-none"
          />
        </div>
        <Button variant="primary" busy={busy} className="py-1.5 text-[12px]" onClick={save}>
          Save
        </Button>
        {isRetailer && row.hasOverride && (
          <button
            onClick={() => post({ retailerId: (target as { retailerId: string }).retailerId, modelId: row.modelId, reset: true })}
            disabled={busy}
            title="Reset to default"
            className="text-[11px] font-medium text-muted hover:text-brass"
          >
            Reset
          </button>
        )}
      </div>
      {error && <span className="col-span-3 text-[11px] text-red-500">{error}</span>}
    </li>
  );
}
