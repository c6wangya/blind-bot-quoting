"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { QuoteDetails } from "@/lib/types";
import { QuoteDetailsFields } from "./QuoteDetailsFields";
import { Button } from "./ui";

/** Edit a quote's header details (customer / ship-to / references) in a slide-over. */
export function QuoteDetailsDrawer({ quoteId, initial }: { quoteId: number; initial: QuoteDetails }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<QuoteDetails>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save");
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[12.5px] font-medium text-brass transition-colors hover:underline"
      >
        Edit details
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} aria-hidden />
          <div className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-lg font-semibold tracking-tight text-ink">Edit quote details</h2>
              <button
                onClick={() => !busy && setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-muted transition-colors hover:bg-[#f1efe9] hover:text-ink"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <QuoteDetailsFields value={d} onChange={setD} />
            </div>
            <div className="border-t border-line px-6 py-4">
              {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
              <Button variant="primary" onClick={save} busy={busy} className="w-full py-2.5">
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
