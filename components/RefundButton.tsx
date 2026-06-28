"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Spinner } from "./ui";

/**
 * Admin-only full refund. Opens a dialog to capture a reason (required) and supporting
 * documents (image/PDF), then POSTs to /api/orders/:id/refund. On success the order becomes Refunded.
 */
export function RefundButton({ orderId, amountLabel }: { orderId: number; amountLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // The trigger sits inside a transform-ed header, which would make a `fixed` overlay anchor to the
  // header instead of the viewport — so the dialog is portaled to <body>.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const submit = async () => {
    if (!reason.trim()) {
      setError("Please enter a reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("reason", reason.trim());
      for (const f of files) fd.append("file", f);
      const r = await fetch(`/api/orders/${orderId}/refund`, { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Refund failed");
      setOpen(false);
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
        Refund
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 text-left">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal className="relative my-auto w-full max-w-lg rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="text-base font-semibold tracking-tight text-ink">Refund this order</h2>
            <p className="mt-1 text-[13px] leading-snug text-ink-soft">
              A full refund of <span className="font-semibold">{amountLabel}</span> will be issued and the order
              closed as <span className="font-medium">Refunded</span>. If it hasn&apos;t shipped, reserved stock is
              released. This cannot be undone.
            </p>

            <label className="mt-4 block text-[12px] font-semibold uppercase tracking-wide text-muted">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="Why is this order being refunded? (shown in the order timeline)"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />

            <label className="mt-3 block text-[12px] font-semibold uppercase tracking-wide text-muted">
              Supporting documents
            </label>
            {/* Native file input is hidden — its "Choose file / No file chosen" text is localised by
                the browser (shows Chinese on a zh browser). A button that clicks the input via ref
                keeps the UI English and lets us list / remove / add multiple files. */}
            <div className="mt-1">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={(e) => {
                  // Materialise the FileList into a concrete array NOW — `e.target.files` is a *live*
                  // list, and the line below clears it. If we deferred `Array.from(...)` into the
                  // setFiles updater it would read the already-emptied list and append nothing.
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = ""; // allow re-selecting the same file after a remove
                  if (picked.length) setFiles((prev) => [...prev, ...picked]);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#f1efe9] px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:bg-[#e9e6dd] disabled:opacity-50"
              >
                + Add files
              </button>
            </div>
            {files.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-line bg-[#faf9f5] px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      disabled={busy}
                      className="shrink-0 text-[12px] font-medium text-muted transition-colors hover:text-red-600 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12px] text-muted">No files chosen.</p>
            )}
            <p className="mt-1 text-[11px] text-muted">Image or PDF, ≤ 10 MB each.</p>

            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="py-2">
                Cancel
              </Button>
              <Button variant="danger" onClick={submit} busy={busy} className="gap-2 py-2">
                {busy && <Spinner />}
                {busy ? (files.length ? "Uploading & refunding…" : "Refunding…") : "Issue refund"}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
