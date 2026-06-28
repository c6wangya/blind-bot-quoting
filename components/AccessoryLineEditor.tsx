"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { usd } from "@/lib/format";
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
 */
export function AccessoryLineEditor({
  itemId,
  qty: initialQty,
  motorStock,
  moq,
  variations: initialVariations,
}: {
  itemId: number;
  qty: number;
  motorStock: number | null;
  moq: number;
  variations: EditorVariation[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { setPending } = useShippingRecalc();
  const [qty, setQty] = useState(initialQty);
  const [vqty, setVqty] = useState<Record<string, number>>(
    () => Object.fromEntries(initialVariations.map((v) => [v.itemId, v.qty]))
  );
  // Busy spans the PATCH (`submitting`) AND the RSC re-render after it (`isPending`), so the shared
  // recalc flag (→ pay button) stays held continuously and the totals never go stale-but-payable.
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;
  useEffect(() => {
    setPending(busy);
  }, [busy, setPending]);

  const minQty = Math.max(1, moq);
  // The motor qty is capped by its own stock and by how many each sub-part can cover (per-motor qty).
  const maxQty = initialVariations.reduce(
    (cap, v) => (v.stock === null ? cap : Math.min(cap, Math.max(1, Math.floor(v.stock / (vqty[v.itemId] ?? 1))))),
    motorStock === null ? Infinity : motorStock
  );

  // Persist the current selection; revert + toast on failure (e.g. server stock 409).
  const commit = async (nextQty: number, nextVqty: Record<string, number>) => {
    const prevQty = qty;
    const prevVqty = vqty;
    setQty(nextQty);
    setVqty(nextVqty);
    setSubmitting(true);
    try {
      const r = await fetch("/api/quote-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          qty: nextQty,
          // qty 0 drops the sub-part from the line (server omits it from the selection).
          variationItems: initialVariations
            .filter((v) => (nextVqty[v.itemId] ?? 1) > 0)
            .map((v) => ({ itemId: v.itemId, qty: nextVqty[v.itemId] ?? 1 })),
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
      setVqty(prevVqty);
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
    commit(next, vqty);
  };
  const setPartQty = (itemId: string, v: number) => {
    if (v === (vqty[itemId] ?? 1)) return;
    commit(qty, { ...vqty, [itemId]: v });
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      {initialVariations.length > 0 && (
        <div className="space-y-2.5">
          {initialVariations.map((v) => {
            const cur = vqty[v.itemId] ?? 1;
            const vMax = v.stock === null ? Infinity : Math.max(1, Math.floor(v.stock / Math.max(1, qty)));
            const hasCaption = v.price > 0 || v.stock !== null;
            return (
              <div key={v.itemId} className="flex items-center gap-4">
                {/* Identity + a single muted caption line (unit price · stock) */}
                <div className="min-w-0 flex-1">
                  <div className="break-words text-[12.5px] text-ink-soft">
                    <span className="text-muted">{v.variationName}:</span>{" "}
                    <span className="font-medium text-ink">{v.itemLabel}</span>
                  </div>
                  {hasCaption && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
                      {v.price > 0 && <span>{usd(v.price)} each</span>}
                      {v.price > 0 && v.stock !== null && <span aria-hidden>·</span>}
                      <StockBadge stock={v.stock} />
                    </div>
                  )}
                </div>
                {/* min 0 so decrementing/typing 0 removes this sub-part from the line. */}
                <Stepper value={cur} min={0} max={vMax} disabled={busy} onChange={(n) => setPartQty(v.itemId, n)} />
                {/* Extended price for this sub-part (per motor) */}
                <div className="w-16 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink">
                  {v.price > 0 ? usd(v.price * cur) : "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className={cx("flex items-center gap-4", initialVariations.length > 0 && "mt-3 border-t border-line pt-3")}>
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
