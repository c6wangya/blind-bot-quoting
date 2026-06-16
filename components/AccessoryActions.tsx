"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

/** Add an orderable accessory (A-OK motor) to the draft quote — qty stepper + Add. */
export function AddAccessoryButton({ modelId }: { modelId: string }) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(addedTimer.current), []);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/quote-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: modelId, qty }),
      });
      if (r.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not add to quote");
      setAdded(true);
      router.refresh();
      clearTimeout(addedTimer.current);
      addedTimer.current = setTimeout(() => setAdded(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-line">
        <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-2.5 py-1 text-ink-soft hover:text-ink">
          −
        </button>
        <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
        <button onClick={() => setQty((q) => Math.min(500, q + 1))} className="px-2.5 py-1 text-ink-soft hover:text-ink">
          +
        </button>
      </div>
      <button
        onClick={add}
        disabled={busy}
        className={cx(
          "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
          added ? "bg-emerald-600 text-white" : "bg-ink text-white hover:bg-[#2a3756]",
          busy && "opacity-50"
        )}
      >
        {busy ? "…" : added ? "✓ Added" : "Add to quote"}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
