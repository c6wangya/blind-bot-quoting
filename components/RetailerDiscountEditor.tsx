"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "./Toast";
import { Button, Card } from "./ui";

/**
 * Admin: set a retailer's standing order-level discount (% off every order subtotal). Stacks on
 * top of any per-motor custom prices; snapshotted onto each order at submit time.
 */
export function RetailerDiscountEditor({
  retailerId,
  label,
  initialPct,
}: {
  retailerId: string;
  label: string;
  initialPct: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(String(initialPct));
  const [busy, setBusy] = useState(false);

  const save = async (pct: number) => {
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast("Enter a discount between 0 and 100", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/motors/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retailerId, pct }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
      toast(pct > 0 ? `${label} now gets ${pct}% off every order` : `Discount cleared for ${label}`);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-semibold text-ink">Order discount</div>
          <div className="text-[12px] text-muted">
            % off this retailer&apos;s order subtotal — applies on top of the prices below, on every order.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-line bg-surface px-2">
            <input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-16 bg-transparent px-1 py-1.5 text-right text-sm text-ink outline-none"
            />
            <span className="text-xs text-muted">%</span>
          </div>
          <Button variant="primary" busy={busy} className="py-1.5 text-[12px]" onClick={() => save(Number(value))}>
            Save
          </Button>
          {Number(value) > 0 && (
            <button
              onClick={() => {
                setValue("0");
                save(0);
              }}
              disabled={busy}
              className="text-[11px] font-medium text-muted hover:text-brass"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
