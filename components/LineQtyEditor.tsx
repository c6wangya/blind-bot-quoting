"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";

/** Inline quantity stepper on a draft quote line — PATCHes the qty and refreshes totals. */
export function LineQtyEditor({ itemId, qty: initial }: { itemId: number; qty: number }) {
  const router = useRouter();
  const [qty, setQty] = useState(initial);
  const [busy, setBusy] = useState(false);

  const update = async (next: number) => {
    const v = Math.max(0, Math.min(500, next));
    if (v === qty || busy) return;
    setBusy(true);
    try {
      // qty 0 removes the line entirely; otherwise re-price at the new qty.
      const r =
        v === 0
          ? await fetch("/api/quote-items", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId }),
            })
          : await fetch("/api/quote-items", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ itemId, qty: v }),
            });
      if (r.ok) {
        if (v !== 0) setQty(v);
        router.refresh();
      } else setQty(qty); // revert on failure
    } catch {
      setQty(qty);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("inline-flex items-center rounded-lg border border-line", busy && "opacity-60")}>
      <button
        onClick={() => update(qty - 1)}
        disabled={busy}
        aria-label="Decrease quantity"
        className="px-2 py-0.5 text-ink-soft transition-colors hover:text-ink"
      >
        −
      </button>
      <span className="w-7 text-center text-[13px] font-semibold tabular-nums">{qty}</span>
      <button
        onClick={() => update(qty + 1)}
        disabled={busy}
        aria-label="Increase quantity"
        className="px-2 py-0.5 text-ink-soft transition-colors hover:text-ink"
      >
        +
      </button>
    </div>
  );
}
