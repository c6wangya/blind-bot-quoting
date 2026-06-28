"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { buildBlockedFromGroups, buildItemNames, disabledFor } from "@/lib/variation-logic";
import { useShippingRecalc } from "./ShippingRecalcContext";
import { useToast } from "./Toast";
import { RemoveItemButton } from "./QuoteActions";
import { cx } from "./ui";

export type EditorVariation = {
  itemId: string;
  variationName: string;
  itemLabel: string;
  qty: number;
  /** Per-unit price of this sub-part (per motor). */
  price: number;
  /** Stock of the sub-part's source model (null = untracked / unlimited). */
  stock: number | null;
};

/** Stock label + tone for one row (motor or sub-part). null = untracked → no badge. */
function StockBadge({ stock }: { stock: number | null }) {
  if (stock === null) return null;
  const tone = stock <= 0 ? "text-red-500" : stock <= 5 ? "text-amber-600" : "text-muted";
  const label = stock <= 0 ? "Out of stock" : stock <= 5 ? `Only ${stock} left` : `${stock} in stock`;
  return <span className={cx("text-[11.5px] font-medium", tone)}>{label}</span>;
}

/**
 * Typeable +/- stepper (mirrors the catalog one). Clamped to [min, max].
 *
 * Typing/clicking updates a local draft instantly; the `onChange` that re-prices server-side is
 * debounced until the user pauses, so typing "100" fires one re-price (not one per digit) and the
 * field never freezes mid-type waiting on a request. Blur / Enter flush immediately.
 */
function Stepper({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the user is mid-edit so an incoming `value` (from a refresh) doesn't clobber the draft.
  const editing = useRef(false);

  // Sync the field to the committed value whenever we're not actively editing.
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);
  // Drop any pending debounce on unmount (line removed / navigated away).
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  // The number the +/- buttons operate on — the live draft, falling back to the committed value.
  const current = () => {
    if (draft.trim() === "") return value;
    const n = Math.floor(Number(draft));
    return Number.isNaN(n) ? value : n;
  };

  // Show `n` now; commit (server round-trip) after a pause, or right away when `immediate`.
  const set = (n: number, immediate = false) => {
    const next = clamp(n);
    setDraft(String(next));
    if (timer.current) clearTimeout(timer.current);
    if (immediate) {
      editing.current = false;
      timer.current = null;
      onChange(next);
      return;
    }
    editing.current = true;
    timer.current = setTimeout(() => {
      timer.current = null;
      editing.current = false;
      onChange(next);
    }, 450);
  };

  return (
    <div className={cx("inline-flex items-center rounded-lg border border-line", disabled && "opacity-60")}>
      <button
        onClick={() => set(current() - 1)}
        disabled={disabled || current() <= min}
        aria-label="Decrease"
        className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        value={draft}
        onChange={(e) => {
          // Keep the field editable even while a previous commit is in flight — only debounce the
          // re-price, never block keystrokes.
          const raw = e.target.value;
          editing.current = true;
          setDraft(raw);
          if (raw === "") return; // empty → wait for more input or blur
          const n = Math.floor(Number(raw));
          if (Number.isNaN(n)) return;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            timer.current = null;
            editing.current = false;
            const next = clamp(n);
            setDraft(String(next)); // normalise the field (e.g. clamp an over-stock entry)
            onChange(next);
          }, 450);
        }}
        onBlur={(e) => {
          const n = Math.floor(Number(e.target.value));
          set(Number.isNaN(n) ? min : n, true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        aria-label="Quantity"
        className="w-11 border-0 bg-transparent text-center text-[13px] font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        onClick={() => set(current() + 1)}
        disabled={disabled || current() >= max}
        aria-label="Increase"
        className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}

/**
 * In-quote editor for an accessory line: the motor qty and each per-motor sub-part qty, all with
 * live stock and limits. Every change re-prices the line server-side (config + computation snapshot)
 * and refreshes the totals; while in flight the pay button is held via the shared recalc flag.
 *
 * `availableParts` are ALL add-on parts the motor model offers (not just the ones already on the
 * line), so the retailer can add a part to an existing motor here — the "+ Add accessory" picker
 * lists every option not yet selected. Adding/removing just changes the per-part selection that the
 * whole-line PATCH replaces, so the server re-prices + re-checks stock the same way as the catalog.
 */
export function AccessoryLineEditor({
  itemId,
  qty: initialQty,
  motorStock,
  moq,
  variations: initialVariations,
  availableParts,
  partStock,
  exclusionGroups,
}: {
  itemId: number;
  qty: number;
  motorStock: number | null;
  moq: number;
  variations: EditorVariation[];
  /** Every add-on part the motor offers (for the "+ Add accessory" picker). */
  availableParts: VariationType[];
  /** Sub-part item_id → its source model's stock (null = untracked). */
  partStock: Record<string, number | null>;
  /** This motor's mutual-exclusion groups (each an array of item ids; at most one per group). */
  exclusionGroups: string[][];
}) {
  const router = useRouter();
  const toast = useToast();
  const { setPending } = useShippingRecalc();
  const [qty, setQty] = useState(initialQty);
  // itemId → per-motor qty for every selected sub-part (qty 0 / absent = not on the line).
  const [sel, setSel] = useState<Record<string, number>>(
    () => Object.fromEntries(initialVariations.map((v) => [v.itemId, v.qty]))
  );
  const [adding, setAdding] = useState(false);
  // Busy spans the PATCH (`submitting`) AND the RSC re-render after it (`isPending`), so the shared
  // recalc flag (→ pay button) stays held continuously and the totals never go stale-but-payable.
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;
  useEffect(() => {
    setPending(busy);
  }, [busy, setPending]);

  // Display metadata (name / price / stock) for any sub-part id — from the catalog's add-on parts,
  // falling back to the line's own snapshot for a part that's since been removed from the catalog.
  const partMeta = useMemo(() => {
    const m: Record<string, { variationName: string; itemLabel: string; price: number; stock: number | null }> = {};
    for (const v of initialVariations) {
      m[v.itemId] = { variationName: v.variationName, itemLabel: v.itemLabel, price: v.price, stock: v.stock };
    }
    for (const t of availableParts) {
      for (const it of t.items) {
        m[it.id] = { variationName: t.name, itemLabel: it.name, price: it.price, stock: partStock[it.id] ?? null };
      }
    }
    return m;
  }, [initialVariations, availableParts, partStock]);

  // Stable render order: parts already on the line first (snapshot order), then the rest of the
  // catalog's options — so a newly-added part appears in a consistent place.
  const orderedIds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of initialVariations) if (!seen.has(v.itemId)) (seen.add(v.itemId), out.push(v.itemId));
    for (const t of availableParts) for (const it of t.items) if (!seen.has(it.id)) (seen.add(it.id), out.push(it.id));
    return out;
  }, [initialVariations, availableParts]);
  const selectedIds = orderedIds.filter((id) => (sel[id] ?? 0) > 0);

  // Mutual exclusion: within a group at most one part may be on the line, so an offered part that
  // shares a group with something already selected is greyed out in the picker (with the conflicting
  // option's name for the tooltip). Mirrors the catalog picker.
  const blocked = useMemo(() => buildBlockedFromGroups(exclusionGroups), [exclusionGroups]);
  const itemNames = useMemo(() => buildItemNames(availableParts), [availableParts]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Parts the motor offers that aren't on the line yet — grouped by variation type for the picker.
  const addable = availableParts
    .map((t) => ({ ...t, items: t.items.filter((it) => (sel[it.id] ?? 0) === 0) }))
    .filter((t) => t.items.length > 0);

  const minQty = Math.max(1, moq);
  // The motor qty is capped by its own stock and by how many each sub-part can cover (per-motor qty).
  const maxQty = selectedIds.reduce((cap, id) => {
    const st = partMeta[id]?.stock ?? null;
    return st === null ? cap : Math.min(cap, Math.max(1, Math.floor(st / (sel[id] ?? 1))));
  }, motorStock === null ? Infinity : motorStock);

  // Persist the current selection; revert + toast on failure (e.g. server stock 409).
  const commit = async (nextQty: number, nextSel: Record<string, number>) => {
    const prevQty = qty;
    const prevSel = sel;
    setQty(nextQty);
    setSel(nextSel);
    setSubmitting(true);
    try {
      const r = await fetch("/api/quote-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          qty: nextQty,
          // qty 0 drops the sub-part from the line (server omits it from the selection).
          variationItems: Object.entries(nextSel)
            .filter(([, q]) => q > 0)
            .map(([id, q]) => ({ itemId: id, qty: q })),
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not update");
      }
      // Hold busy through the re-render so the pay button doesn't flash enabled on a stale total.
      startTransition(() => router.refresh());
    } catch (e) {
      setQty(prevQty);
      setSel(prevSel);
      toast((e as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  // Remove the whole line (motor + its sub-parts). Mirrors RemoveItemButton, but reachable from the
  // qty stepper so dropping the motor qty to 0 deletes the line.
  const removeLine = async () => {
    setSubmitting(true);
    try {
      const r = await fetch("/api/quote-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not remove");
      }
      startTransition(() => router.refresh());
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const setMotorQty = (v: number) => {
    if (v === 0) {
      void removeLine();
      return;
    }
    const next = Math.max(minQty, v);
    if (next === qty) return;
    commit(next, sel);
  };
  const setPartQty = (itemId: string, v: number) => {
    if (v === (sel[itemId] ?? 0)) return;
    commit(qty, { ...sel, [itemId]: v });
  };
  // Add an offered part to this motor (per-motor qty starts at 1) and persist.
  const addPart = (id: string) => {
    if ((sel[id] ?? 0) > 0) return;
    // Guard: never add a part that's mutually exclusive with something already on the line.
    for (const conflict of blocked.get(id) ?? []) if (selectedSet.has(conflict)) return;
    setAdding(false);
    commit(qty, { ...sel, [id]: 1 });
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      {selectedIds.length > 0 && (
        <div className="space-y-2.5">
          {selectedIds.map((id) => {
            const meta = partMeta[id];
            if (!meta) return null;
            const cur = sel[id] ?? 1;
            const vMax = meta.stock === null ? Infinity : Math.max(1, Math.floor(meta.stock / Math.max(1, qty)));
            const hasCaption = meta.price > 0 || meta.stock !== null;
            return (
              <div key={id} className="flex items-center gap-4">
                {/* Identity + a single muted caption line (unit price · stock) */}
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[12.5px] text-ink-soft">
                    <span className="text-muted">{meta.variationName}:</span>{" "}
                    <span className="font-medium text-ink">{meta.itemLabel}</span>
                  </div>
                  {hasCaption && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
                      {meta.price > 0 && <span>{usd(meta.price)} each</span>}
                      {meta.price > 0 && meta.stock !== null && <span aria-hidden>·</span>}
                      <StockBadge stock={meta.stock} />
                    </div>
                  )}
                </div>
                {/* min 0 so decrementing/typing 0 removes this sub-part from the line. */}
                <Stepper value={cur} min={0} max={vMax} disabled={busy} onChange={(n) => setPartQty(id, n)} />
                {/* Extended price for this sub-part (per motor) */}
                <div className="w-16 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink">
                  {meta.price > 0 ? usd(meta.price * cur) : "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add another part to this motor — lists every offered option not already on the line. */}
      {addable.length > 0 && (
        <div className={cx(selectedIds.length > 0 && "mt-3")}>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-brass transition-colors hover:underline disabled:opacity-50"
            >
              <span className="text-[10px] leading-none" aria-hidden>+</span>
              Add accessory
            </button>
          ) : (
            <div className="rounded-xl border border-line bg-[#faf9f6] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Add a part · qty per motor</span>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="rounded-full border border-line px-3 py-1 text-[11.5px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
                >
                  Done
                </button>
              </div>
              <div className="space-y-3">
                {addable.map((t) => {
                  const { ids: offIds, reason } = disabledFor(t, selectedSet, blocked, itemNames);
                  return (
                    <div key={t.id}>
                      <div className="mb-1.5 text-[11.5px] font-medium text-ink-soft">{t.name}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {t.items.map((it) => {
                          const off = offIds.has(it.id);
                          return (
                            <button
                              key={it.id}
                              type="button"
                              disabled={busy || off}
                              title={off ? `Not compatible with ${reason[it.id] ?? "your current selection"}` : undefined}
                              onClick={() => addPart(it.id)}
                              className={cx(
                                "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                                off
                                  ? "cursor-not-allowed border-line text-ink-soft opacity-40"
                                  : "border-line bg-surface text-ink-soft hover:border-ink disabled:opacity-50"
                              )}
                            >
                              {it.name}
                              {it.price ? ` (+${usd(it.price)})` : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className={cx("flex items-center gap-4", (selectedIds.length > 0 || addable.length > 0) && "mt-3 border-t border-line pt-3")}>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-ink">Quantity</div>
          {moq > 0 && <div className="mt-0.5 text-[11px] text-muted">Min order {moq}</div>}
        </div>
        {/* min 0 so decrementing/typing 0 removes the line; setMotorQty re-clamps nonzero values to moq. */}
        <Stepper value={qty} min={0} max={maxQty} disabled={busy} onChange={setMotorQty} />
        <div className="w-16 shrink-0 text-right">
          <RemoveItemButton itemId={itemId} />
        </div>
      </div>
    </div>
  );
}
