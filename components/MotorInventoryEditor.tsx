"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card } from "./ui";

export type InventoryRow = { modelId: string; name: string; sku: string; category: string; stock: number | null };

/** Admin: set/adjust each orderable motor's stock. No value = untracked (unlimited). */
export function MotorInventoryEditor({ rows }: { rows: InventoryRow[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[1fr_140px_120px] gap-3 border-b border-line bg-[#fafaf7] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span>Motor</span>
        <span>Stock</span>
        <span />
      </div>
      <ul className="divide-y divide-line/70">
        {rows.map((r) => (
          <Row key={r.modelId} row={r} />
        ))}
      </ul>
    </Card>
  );
}

function Row({ row }: { row: InventoryRow }) {
  const router = useRouter();
  const [value, setValue] = useState(row.stock === null ? "" : String(row.stock));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/motors/inventory", {
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

  return (
    <li className="grid grid-cols-[1fr_140px_120px] items-center gap-3 px-5 py-3">
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-ink">{row.name}</div>
        <div className="truncate text-[11px] text-muted">
          {row.category} · <span className="font-mono">{row.sku}</span>
        </div>
      </div>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="untracked"
        className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-ink"
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="primary"
          busy={busy}
          className="py-1.5 text-[12px]"
          onClick={() =>
            value.trim() === ""
              ? post({ modelId: row.modelId, clear: true })
              : post({ modelId: row.modelId, stock: Number(value) })
          }
        >
          Save
        </Button>
      </div>
      {error && <span className="col-span-3 text-[11px] text-red-500">{error}</span>}
    </li>
  );
}
