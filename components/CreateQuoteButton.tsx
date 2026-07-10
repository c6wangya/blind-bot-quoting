"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Button, cx } from "./ui";
import { useToast } from "./Toast";

/**
 * Accessory quote quick-create. Products are disabled, so "Create New Quote" no longer needs the
 * full customer/ship-to header form (that lives in `NewQuoteFlow` at `/quotes/new`, kept intact
 * for when products return). This just captures an optional name and creates a draft — mirroring
 * the inline create in the accessory browser (`useDefaultAddress` pre-fills the ship-to) — then
 * opens the new quote so the retailer can add accessories.
 */
export function CreateQuoteButton({ className }: { className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const quoteName = name.trim();
      const r = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quoteName: quoteName || null, useDefaultAddress: true }),
      });
      if (r.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent("/quotes")}`);
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not create quote");
      toast(`Created ${quoteName || data.quote.ref}`);
      router.push(`/quotes/${data.quote.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cx(
          "inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#2a3756] hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass/50 focus-visible:ring-offset-1",
          className
        )}
      >
        Create New Quote
      </button>

      {/* Portal to <body> so the modal centers on the viewport, not within the page layout.
          `open` only flips true on a client click, so it's never rendered during SSR. */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 text-left md:pl-60">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal className="relative my-auto w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="text-base font-semibold tracking-tight text-ink">New quote</h2>
            <p className="mt-2 text-[13px] leading-snug text-ink-soft">
              Give it a name (optional) — we&apos;ll pre-fill your default ship-to details. Add accessories next.
            </p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create();
                if (e.key === "Escape" && !busy) setOpen(false);
              }}
              placeholder="Quote name (optional)"
              className="mt-4 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
            />
            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="py-2">
                Cancel
              </Button>
              <Button variant="primary" onClick={create} busy={busy} className="py-2">
                {busy ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
