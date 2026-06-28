"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";

/**
 * Cancel an UNPAID order (retailer's own, or admin). Releases reserved stock and reopens the quote
 * for editing. Sits in the order header next to Refund. Portaled to <body> so the dialog escapes the
 * transform-ed header (a `fixed` overlay would otherwise anchor to the header, not the viewport).
 */
export function CancelOrderButton({ orderId }: { orderId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not cancel order");
      if (data.quoteId) router.push(`/quotes/${data.quoteId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
      >
        Cancel order
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 text-left">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal className="relative my-auto w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="text-base font-semibold tracking-tight text-ink">Cancel this order?</h2>
            <p className="mt-2 text-[13px] leading-snug text-ink-soft">
              Your quote reopens for editing and any reserved stock is released. This can only be done before payment.
            </p>
            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="py-2">
                Keep order
              </Button>
              <Button variant="danger" onClick={cancel} busy={busy} className="py-2">
                {busy ? "Cancelling…" : "Cancel order"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
