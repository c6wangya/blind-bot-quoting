"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { stashPendingItem } from "@/lib/pending-item";
import type { VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { availableTypes, buildBlockedFromGroups, buildItemNames, disabledFor } from "@/lib/variation-logic";
import { Button, cx } from "./ui";

/** Multi-select the items of a variation. Items with images render as visual cards (tap the image to zoom);
 *  otherwise as text chips. `values` are the currently-selected ids; `onToggle` flips one. Items in
 *  `disabled` share an exclusion group with a current pick and can't be added; `disabledReason` maps
 *  an item id → the conflicting option's name, shown on hover. */
export function VariationPicker({
  type,
  values,
  onToggle,
  onZoom,
  disabled,
  disabledReason,
}: {
  type: VariationType;
  values: string[];
  onToggle: (id: string) => void;
  onZoom: (url: string) => void;
  disabled: Set<string>;
  disabledReason: Record<string, string>;
}) {
  const reason = (id: string) => (disabledReason[id] ? `Not compatible with ${disabledReason[id]}` : "Not compatible with your current selection");
  const hasImages = type.items.some((i) => i.image);
  if (!hasImages) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {type.items.map((it) => {
          const sel = values.includes(it.id);
          const off = disabled.has(it.id) && !sel;
          return (
            <button
              key={it.id}
              type="button"
              disabled={off}
              onClick={() => onToggle(it.id)}
              title={off ? reason(it.id) : undefined}
              className={cx(
                "rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                off ? "cursor-not-allowed border-line opacity-40" : sel ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-soft hover:border-ink"
              )}
            >
              {it.name}{it.price ? ` (+${usd(it.price)})` : ""}
            </button>
          );
        })}
      </div>
    );
  }
  const cardCx = (sel: boolean, off: boolean) =>
    cx(
      "relative w-24 shrink-0 rounded-xl border p-1.5 text-left transition-colors",
      off ? "cursor-not-allowed border-line opacity-40" : sel ? "border-ink ring-2 ring-ink/15" : "border-line hover:border-ink"
    );
  return (
    <div className="flex flex-wrap gap-2">
      {type.items.map((it) => {
        const sel = values.includes(it.id);
        const off = disabled.has(it.id) && !sel;
        return (
          <button
            key={it.id}
            type="button"
            disabled={off}
            onClick={() => !off && onToggle(it.id)}
            title={off ? reason(it.id) : undefined}
            className={cardCx(sel, off)}
          >
            <div className="relative">
              {it.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.image}
                  alt={it.name}
                  onClick={off ? undefined : (e) => { e.stopPropagation(); onZoom(it.image!); }}
                  title={off ? undefined : "Click to enlarge"}
                  className={cx("h-16 w-full rounded-lg bg-[#0e0e10] object-contain p-1", !off && "cursor-zoom-in")}
                />
              ) : (
                <div className="h-16 w-full rounded-lg bg-[#f1efe9]" />
              )}
            </div>
            <div className="mt-1 truncate text-[11.5px] font-medium text-ink">{it.name}</div>
            {it.price ? <div className="text-[10.5px] text-muted">+{usd(it.price)}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Add a product to a quote — qty + any (multi-select) variation choices, capped at stock. */
export function AddAccessoryButton({
  modelId,
  quoteId,
  stock,
  variations = [],
  availableItemIds = [],
  defaultItemIds = [],
  exclusionGroups = {},
  minOrder = 0,
}: {
  modelId: string;
  quoteId?: number;
  /** available stock; null = untracked (unlimited) */
  stock?: number | null;
  variations?: VariationType[];
  /** variation item ids assigned to this product */
  availableItemIds?: string[];
  /** variation item ids pre-selected by default */
  defaultItemIds?: string[];
  /** model_id → exclusion groups (each a list of item ids; at most one per group is pickable) */
  exclusionGroups?: Record<string, string[][]>;
  /** minimum order quantity (0 = none); the qty stepper can't go below it */
  minOrder?: number;
}) {
  const router = useRouter();
  const minQty = Math.max(1, minOrder);
  const [qty, setQty] = useState(minQty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  // Variation types available for this product (only assigned items).
  const avail = useMemo(() => availableTypes(variations, availableItemIds), [variations, availableItemIds]);
  const hasVariations = avail.length > 0;

  const blocked = useMemo(() => buildBlockedFromGroups(exclusionGroups[modelId] ?? []), [exclusionGroups, modelId]);
  const itemName = useMemo(() => buildItemNames(avail), [avail]);

  // Multi-select per type: each type holds a list of chosen item ids ([] = none). Seeded with the
  // product's admin-set defaults, skipping any default that would conflict with one already seeded
  // (an exclusion group only permits one), so the initial selection is always valid.
  const [pick, setPick] = useState<Record<string, string[]>>(() => {
    const p: Record<string, string[]> = {};
    const chosen = new Set<string>();
    const compatible = (id: string) => {
      const c = blocked.get(id);
      if (!c) return true;
      for (const x of chosen) if (c.has(x)) return false;
      return true;
    };
    for (const t of avail) {
      const ids: string[] = [];
      for (const i of t.items)
        if (defaultItemIds.includes(i.id) && compatible(i.id)) {
          ids.push(i.id);
          chosen.add(i.id);
        }
      p[t.id] = ids;
    }
    return p;
  });

  const selectedIds = avail.flatMap((t) => pick[t.id] ?? []);
  const selectedSet = new Set(selectedIds);

  // Toggle an item within a type. Adding one drops any selected item (any type) sharing an
  // exclusion group with it, so the user is never wedged into an invalid combination.
  const choose = (typeId: string, itemId: string) =>
    setPick((prev) => {
      const cur = prev[typeId] ?? [];
      if (cur.includes(itemId)) return { ...prev, [typeId]: cur.filter((x) => x !== itemId) };
      const conflicts = blocked.get(itemId);
      const next: Record<string, string[]> = {};
      for (const [tid, ids] of Object.entries(prev)) next[tid] = conflicts ? ids.filter((id) => !conflicts.has(id)) : ids;
      next[typeId] = [...(next[typeId] ?? []), itemId];
      return next;
    });

  const tracked = stock !== null && stock !== undefined;
  const outOfStock = tracked && stock === 0;
  const max = tracked ? (stock as number) : Infinity;

  const submit = async (variationItemIds: string[]) => {
    setBusy(true);
    setError(null);
    if (quoteId) {
      try {
        const r = await fetch("/api/quote-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: modelId, qty, quoteId, variationItemIds }),
        });
        if (r.status === 401) {
          window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
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
    stashPendingItem({ kind: "accessory", productId: modelId, qty, variationItemIds });
    router.push("/quotes/new");
  };

  const onAdd = () => {
    if (hasVariations) setModal(true);
    else submit([]);
  };

  // Variations are all optional — submit whatever's selected (may be none).
  const confirmModal = () => submit(selectedIds);

  if (outOfStock) return <span className="text-[11px] font-medium text-red-500">Out of stock</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg border border-line">
          <button onClick={() => setQty((q) => Math.max(minQty, q - 1))} disabled={qty <= minQty} aria-label="Decrease quantity" className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30">
            −
          </button>
          <input
            type="number"
            min={minQty}
            max={tracked ? max : undefined}
            value={qty}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") { setQty(minQty); return; }
              const n = Math.floor(Number(v));
              if (!Number.isNaN(n)) setQty(Math.min(max, Math.max(minQty, n)));
            }}
            onBlur={(e) => {
              const n = Math.floor(Number(e.target.value));
              setQty(Number.isNaN(n) ? minQty : Math.min(max, Math.max(minQty, n)));
            }}
            aria-label="Quantity"
            className="w-12 border-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} aria-label="Increase quantity" className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30">
            +
          </button>
        </div>
        <button
          onClick={onAdd}
          disabled={busy}
          className={cx("rounded-lg bg-ink px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#2a3756]", busy && "opacity-50")}
        >
          {busy ? "…" : "Add to quote"}
        </button>
      </div>
      {tracked && <span className={cx("text-[10.5px]", (stock as number) <= 5 ? "text-amber-600" : "text-muted")}>Only {stock} left</span>}
      {error && !modal && <span className="text-[11px] text-red-500">{error}</span>}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setModal(false)} aria-hidden />
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="text-base font-semibold tracking-tight text-ink">Options</h2>
            <p className="mt-1 text-[12.5px] text-muted">Choose variations for this product, or skip.</p>

            <div className="mt-4 space-y-4">
              {/* Each type is an optional multi-select; exclusion groups grey out conflicting items. */}
              {avail.map((t) => {
                const d = disabledFor(t, selectedSet, blocked, itemName);
                return (
                  <div key={t.id}>
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                    <VariationPicker
                      type={t}
                      values={pick[t.id] ?? []}
                      onToggle={(v) => choose(t.id, v)}
                      onZoom={setZoom}
                      disabled={d.ids}
                      disabledReason={d.reason}
                    />
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(false)} disabled={busy} className="py-2">
                Cancel
              </Button>
              <Button variant="primary" onClick={confirmModal} busy={busy} className="py-2">
                Add to quote
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Image zoom (lightbox) */}
      {zoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-8" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-xl bg-[#0e0e10] object-contain p-2" />
        </div>
      )}
    </div>
  );
}
