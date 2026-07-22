"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { ReplacementPicker, type PickerModel, type ReplacementDraft } from "./ReplacementPicker";
import { Button, Spinner, cx } from "./ui";

/** A refundable (returnable) order line, with how many units remain refundable. */
export type ReturnableLine = {
  itemId: number;
  name: string;
  sub: string;
  unitPrice: number;
  orderedQty: number;
  refundedQty: number;
};

/**
 * Admin partial/full refund with optional exchange. Select a quantity of chosen lines to return,
 * optionally queue replacement accessories to ship in their place, attach a reason + supporting
 * documents, and issue. Cash refunded = max(0, returned − replacement) ("多退少不补"). POSTs a
 * multipart body to /api/orders/:id/refund; on success the order becomes Partially refunded (or
 * Refunded once every line is fully returned).
 */
export function RefundButton({
  orderId,
  paidLabel,
  alreadyRefunded,
  lines,
  preShipment,
  picker,
}: {
  orderId: number;
  paidLabel: string;
  alreadyRefunded: number;
  lines: ReturnableLine[];
  preShipment: boolean;
  picker: { models: PickerModel[]; variations: VariationType[]; exclusionGroups: Record<string, string[][]> };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // itemId → return qty (absent / 0 = not selected).
  const [qtyById, setQtyById] = useState<Record<number, number>>({});
  const [replacements, setReplacements] = useState<ReplacementDraft[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const remainingOf = (l: ReturnableLine) => l.orderedQty - l.refundedQty;
  const returnedValue = lines.reduce((s, l) => s + l.unitPrice * (qtyById[l.itemId] ?? 0), 0);
  const replacementValue = replacements.reduce((s, r) => s + r.value, 0);
  const cash = Math.max(0, Math.round((returnedValue - replacementValue) * 100) / 100);
  const waived = Math.max(0, Math.round((replacementValue - returnedValue) * 100) / 100);
  const anyReturn = lines.some((l) => (qtyById[l.itemId] ?? 0) > 0);

  const reset = () => {
    setQtyById({});
    setReplacements([]);
    setReason("");
    setFiles([]);
    setError(null);
  };

  const setQty = (l: ReturnableLine, next: number) => {
    const clamped = Math.max(0, Math.min(remainingOf(l), next));
    setQtyById((prev) => ({ ...prev, [l.itemId]: clamped }));
  };

  // "Refund everything" shortcut: max out every line that still has refundable units (or clear all).
  const selectableLines = lines.filter((l) => remainingOf(l) > 0);
  const allSelected = selectableLines.length > 0 && selectableLines.every((l) => (qtyById[l.itemId] ?? 0) === remainingOf(l));
  const toggleSelectAll = () =>
    setQtyById(allSelected ? {} : Object.fromEntries(selectableLines.map((l) => [l.itemId, remainingOf(l)])));

  const submit = async () => {
    if (!anyReturn) return setError("Select at least one line to refund.");
    if (!reason.trim()) return setError("Please enter a reason.");
    if (!files.length) return setError("Please attach at least one supporting document.");
    setBusy(true);
    setError(null);
    try {
      const returns = lines
        .filter((l) => (qtyById[l.itemId] ?? 0) > 0)
        .map((l) => ({ itemId: l.itemId, qty: qtyById[l.itemId] }));
      const reps = replacements.map((r) => ({ productId: r.productId, qty: r.qty, variationItemIds: r.variationItemIds }));
      const fd = new FormData();
      fd.set("reason", reason.trim());
      fd.set("returns", JSON.stringify(returns));
      fd.set("replacements", JSON.stringify(reps));
      // Returned goods always release their reservation pre-shipment (the server ignores this once
      // shipped — the goods have already left). No user toggle: a return means the units come back.
      fd.set("restock", "true");
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
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
      >
        Refund
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-6 text-left">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setOpen(false)} aria-hidden />
          <div role="dialog" aria-modal className="relative my-auto flex max-h-[calc(100vh-3rem)] w-full max-w-xl flex-col rounded-2xl bg-surface shadow-2xl">
            <div className="shrink-0 border-b border-line px-6 pb-3 pt-6">
              <h2 className="text-base font-semibold tracking-tight text-ink">Refund / exchange</h2>
              <p className="mt-1 text-[12.5px] text-muted">
                Paid <span className="font-semibold text-ink">{paidLabel}</span>
                {alreadyRefunded > 0 && <> · already refunded <span className="font-semibold text-ink">{usd(alreadyRefunded)}</span></>}
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {/* ① Items to return */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Items to return</span>
                {selectableLines.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-[12px] font-medium text-brass hover:underline"
                  >
                    {allSelected ? "Clear all" : "Select all (full refund)"}
                  </button>
                )}
              </div>
              <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                {lines.map((l) => {
                  const remaining = remainingOf(l);
                  const done = remaining <= 0;
                  const q = qtyById[l.itemId] ?? 0;
                  return (
                    <li key={l.itemId} className={cx("flex items-center gap-3 px-3 py-2.5", done && "opacity-50")}>
                      <input
                        type="checkbox"
                        disabled={done}
                        checked={q > 0}
                        onChange={(e) => setQty(l, e.target.checked ? remaining : 0)}
                        className="size-4 shrink-0 accent-ink"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-ink">{l.name}</div>
                        <div className="truncate text-[11px] text-muted">
                          {l.sub} · {usd(l.unitPrice)} each
                          {done ? " · fully refunded" : l.refundedQty > 0 ? ` · ${l.refundedQty} already refunded` : ""}
                        </div>
                      </div>
                      {!done && (
                        <div className="flex items-center rounded-lg border border-line">
                          <button onClick={() => setQty(l, q - 1)} disabled={q <= 0} className="px-2 py-0.5 text-ink-soft hover:text-ink disabled:opacity-30">
                            −
                          </button>
                          <span className="w-8 text-center text-[13px] font-semibold tabular-nums">{q}</span>
                          <button onClick={() => setQty(l, q + 1)} disabled={q >= remaining} className="px-2 py-0.5 text-ink-soft hover:text-ink disabled:opacity-30">
                            +
                          </button>
                          <span className="pl-1 pr-2 text-[10.5px] text-muted">/ {remaining}</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* ② Exchange replacement (optional) */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Replacement (optional)</span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="rounded-lg bg-[#f1efe9] px-2.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-[#e9e6dd]"
                >
                  + Add accessory
                </button>
              </div>
              {replacements.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {replacements.map((r, i) => (
                    <li key={`${r.productId}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-[#faf9f5] px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {r.name} <span className="text-muted">×{r.qty}</span>
                      </span>
                      <span className="shrink-0 text-[12.5px] font-semibold tabular-nums text-ink">{usd(r.value)}</span>
                      <button
                        type="button"
                        onClick={() => setReplacements((prev) => prev.filter((_, j) => j !== i))}
                        className="shrink-0 text-[12px] font-medium text-muted transition-colors hover:text-red-600"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[12px] text-muted">No replacement — refund cash only.</p>
              )}
            </div>

            {/* Returned goods release their reservation automatically pre-shipment. */}
            {preShipment && (
              <p className="mt-4 text-[12px] text-muted">
                Returned items&apos; reserved stock is released back to inventory.
              </p>
            )}

            {/* Reason */}
            <label className="mt-4 block text-[12px] font-semibold uppercase tracking-wide text-muted">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this being refunded? (shown in the order timeline)"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />

            {/* Supporting documents (required) */}
            <label className="mt-3 block text-[12px] font-semibold uppercase tracking-wide text-muted">Supporting documents</label>
            <div className="mt-1">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
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
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-[#faf9f5] px-3 py-2">
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
              <p className="mt-2 text-[12px] text-muted">Required — image or PDF, ≤ 10 MB each.</p>
            )}
            </div>

            {/* Footer — totals + actions, always visible while the body scrolls */}
            <div className="shrink-0 border-t border-line px-6 py-4">
              <div className="space-y-1 text-[13px]">
                <div className="flex justify-between text-ink-soft">
                  <span>Returned</span>
                  <span className="tabular-nums">{usd(Math.round(returnedValue * 100) / 100)}</span>
                </div>
                {replacementValue > 0 && (
                  <div className="flex justify-between text-ink-soft">
                    <span>Replacement</span>
                    <span className="tabular-nums">−{usd(Math.round(replacementValue * 100) / 100)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-0.5 text-[15px] font-semibold text-ink">
                  <span>Cash refund</span>
                  <span className="tabular-nums">{usd(cash)}</span>
                </div>
                {waived > 0 && (
                  <p className="pt-0.5 text-[11.5px] text-muted">
                    Replacement exceeds the returned value — the {usd(waived)} balance is waived (not charged).
                  </p>
                )}
              </div>

              {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="py-2">
                  Cancel
                </Button>
                <Button variant="danger" onClick={submit} busy={busy} disabled={!anyReturn} className="gap-2 py-2">
                  {busy && <Spinner />}
                  {busy ? "Processing…" : `Refund ${usd(cash)}${replacements.length ? " & exchange" : ""}`}
                </Button>
              </div>
            </div>
          </div>

          {pickerOpen && (
            <ReplacementPicker
              models={picker.models}
              variations={picker.variations}
              exclusionGroups={picker.exclusionGroups}
              onAdd={(draft) => setReplacements((prev) => [...prev, draft])}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>,
        document.body
      )}
    </>
  );
}
