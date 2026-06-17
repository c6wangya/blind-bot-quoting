"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { stashPendingItem } from "@/lib/pending-item";
import { cx } from "./ui";

/** Add an orderable accessory (A-OK motor) to a quote — qty stepper + Add, capped at stock. */
export function AddAccessoryButton({
  modelId,
  quoteId,
  stock,
}: {
  modelId: string;
  quoteId?: number;
  /** available stock; null = untracked (unlimited) */
  stock?: number | null;
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tracked = stock !== null && stock !== undefined;
  const outOfStock = tracked && stock === 0;
  const max = tracked ? (stock as number) : 500;

  const add = async () => {
    setBusy(true);
    setError(null);
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
    stashPendingItem({ kind: "accessory", productId: modelId, qty });
    router.push("/quotes/new");
  };

  if (outOfStock) {
    return <span className="text-[11px] font-medium text-red-500">Out of stock</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-line">
          <button
            onClick={() => setQty((qq) => Math.max(1, qq - 1))}
            aria-label="Decrease quantity"
            className="px-2.5 py-1 text-ink-soft hover:text-ink"
          >
            −
          </button>
          <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
          <button
            onClick={() => setQty((qq) => Math.min(max, qq + 1))}
            disabled={qty >= max}
            aria-label="Increase quantity"
            className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30"
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
      </div>
      {tracked && (
        <span className={cx("text-[10.5px]", (stock as number) <= 5 ? "text-amber-600" : "text-muted")}>
          Only {stock} left
        </span>
      )}
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
