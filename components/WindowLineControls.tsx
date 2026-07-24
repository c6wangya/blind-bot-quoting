"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";

// Inline controls for a window-product quote line: qty stepper (server re-prices via the
// window update path with the stored config), edit link (re-opens the configurator), remove.
// Rendered only while the quote is an editable draft.

type Props = {
  itemId: number;
  qty: number;
  editHref: string;
  /** Full stored window config — resent verbatim on qty change so the server re-validates. */
  window: Record<string, unknown>;
};

export default function WindowLineControls({ itemId, qty, editHref, window: windowConfig }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setQty(next: number) {
    if (next < 1 || next > 500 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quote-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: next, window: { ...windowConfig, itemId } }),
      });
      if (!res.ok) {
        const out = await res.json();
        setError(out.error ?? "Update failed");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/quote-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex items-center gap-3 text-xs">
      <div className={cx("flex items-center rounded-lg border border-line", busy && "opacity-50")}>
        <button onClick={() => setQty(qty - 1)} className="px-2 py-0.5 text-ink-soft hover:text-ink" aria-label="Decrease quantity">
          −
        </button>
        <span className="min-w-6 text-center tabular-nums">{qty}</span>
        <button onClick={() => setQty(qty + 1)} className="px-2 py-0.5 text-ink-soft hover:text-ink" aria-label="Increase quantity">
          +
        </button>
      </div>
      <Link href={editHref} className="font-medium text-brass hover:underline">
        Edit
      </Link>
      <button onClick={remove} className="font-medium text-red-500 hover:text-red-700">
        Remove
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
