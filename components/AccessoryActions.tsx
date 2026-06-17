"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { stashPendingItem } from "@/lib/pending-item";
import { cx } from "./ui";

/** Add an orderable accessory (A-OK motor) to a quote — qty stepper + Add. */
export function AddAccessoryButton({ modelId, quoteId }: { modelId: string; quoteId?: number }) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    // Adding from a specific quote's "Add Product" → straight into it.
    if (quoteId) {
      try {
        const r = await fetch("/api/quote-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: modelId, qty, quoteId }),
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
    // No quote context → stash and go decide/create one.
    stashPendingItem({ kind: "accessory", productId: modelId, qty });
    router.push("/quotes/new");
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center rounded-lg border border-line">
        <button
          onClick={() => setQty((q) => Math.max(1, q - 1))}
          aria-label="Decrease quantity"
          className="px-2.5 py-1 text-ink-soft hover:text-ink"
        >
          −
        </button>
        <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
        <button
          onClick={() => setQty((q) => Math.min(500, q + 1))}
          aria-label="Increase quantity"
          className="px-2.5 py-1 text-ink-soft hover:text-ink"
        >
          +
        </button>
      </div>
      <button
        onClick={add}
        disabled={busy}
        className={cx(
          "rounded-lg bg-ink px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2a3756]",
          busy && "opacity-50"
        )}
      >
        {busy ? "…" : "Add to quote"}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
