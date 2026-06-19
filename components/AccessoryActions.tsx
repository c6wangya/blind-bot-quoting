"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { stashPendingItem, type PendingCrownDriver } from "@/lib/pending-item";
import type { MotorOption } from "@/lib/types";
import { usd } from "@/lib/format";
import { Button, cx } from "./ui";

/** Add an orderable motor to a quote — qty + optional Crown & Driver choice, capped at stock. */
export function AddAccessoryButton({
  modelId,
  quoteId,
  stock,
  crownOptions = [],
  driverOptions = [],
}: {
  modelId: string;
  quoteId?: number;
  /** available stock; null = untracked (unlimited) */
  stock?: number | null;
  crownOptions?: MotorOption[];
  driverOptions?: MotorOption[];
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [mode, setMode] = useState<"not-needed" | "crown-driver">("not-needed");
  const [crownId, setCrownId] = useState(crownOptions[0]?.id ?? "");
  const [driverId, setDriverId] = useState(driverOptions[0]?.id ?? "");

  const hasCrownDriver = crownOptions.length > 0 && driverOptions.length > 0;
  const tracked = stock !== null && stock !== undefined;
  const outOfStock = tracked && stock === 0;
  const max = tracked ? (stock as number) : 500;

  const submit = async (crownDriver: PendingCrownDriver) => {
    setBusy(true);
    setError(null);
    if (quoteId) {
      try {
        const r = await fetch("/api/quote-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: modelId, qty, quoteId, crownDriver }),
        });
        if (r.status === 401) {
          window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
          return;
        }
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Could not add to quote");
        router.push(`/quotes/${quoteId}`);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
      return;
    }
    stashPendingItem({ kind: "accessory", productId: modelId, qty, crownDriver });
    router.push("/quotes/new");
  };

  const onAdd = () => {
    if (hasCrownDriver) setModal(true);
    else submit({ mode: "not-needed" });
  };

  const confirmModal = () => {
    if (mode === "crown-driver") {
      if (!crownId || !driverId) {
        setError("Pick a crown and a driver");
        return;
      }
      submit({ mode: "crown-driver", crownId, driverId });
    } else {
      submit({ mode: "not-needed" });
    }
  };

  if (outOfStock) return <span className="text-[11px] font-medium text-red-500">Out of stock</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-line">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" className="px-2.5 py-1 text-ink-soft hover:text-ink">
            −
          </button>
          <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
          <button onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} aria-label="Increase quantity" className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30">
            +
          </button>
        </div>
        <button
          onClick={onAdd}
          disabled={busy}
          className={cx("rounded-lg bg-ink px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2a3756]", busy && "opacity-50")}
        >
          {busy ? "…" : "Add to quote"}
        </button>
      </div>
      {tracked && <span className={cx("text-[10.5px]", (stock as number) <= 5 ? "text-amber-600" : "text-muted")}>Only {stock} left</span>}
      {error && !modal && <span className="text-[11px] text-red-500">{error}</span>}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setModal(false)} aria-hidden />
          <div className="relative w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="text-base font-semibold tracking-tight text-ink">Crown &amp; Driver</h2>
            <p className="mt-1 text-[12.5px] text-muted">Add a crown + driver to this motor, or skip it.</p>

            <div className="mt-4 space-y-2">
              <label className={cx("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm", mode === "not-needed" ? "border-ink bg-[#faf9f5]" : "border-line")}>
                <input type="radio" checked={mode === "not-needed"} onChange={() => setMode("not-needed")} />
                Not needed <span className="text-muted">— no crown &amp; driver</span>
              </label>
              <label className={cx("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm", mode === "crown-driver" ? "border-ink bg-[#faf9f5]" : "border-line")}>
                <input type="radio" checked={mode === "crown-driver"} onChange={() => setMode("crown-driver")} />
                Crown + Driver
              </label>
            </div>

            {mode === "crown-driver" && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Crown</span>
                  <select value={crownId} onChange={(e) => setCrownId(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-ink">
                    {crownOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}{o.priceDelta ? ` (+${usd(o.priceDelta)})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Driver</span>
                  <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-ink">
                    {driverOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}{o.priceDelta ? ` (+${usd(o.priceDelta)})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(false)} disabled={busy} className="py-2">
                Cancel
              </Button>
              <Button variant="primary" onClick={confirmModal} busy={busy} className="py-2">
                Add to quote
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
