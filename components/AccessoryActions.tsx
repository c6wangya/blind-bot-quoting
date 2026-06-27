"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { stashPendingItem } from "@/lib/pending-item";
import type { VariationRestriction, VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { Button, cx } from "./ui";

/** Pick one item of a variation. Items with images render as visual cards (tap 🔍 to zoom);
 *  otherwise a text dropdown. `allowNone` adds a "None" choice (independent variations).
 *  `disabled` items are incompatible with the current selection elsewhere and can't be picked;
 *  `disabledReason` maps an item id → the conflicting option's name, shown on hover. */
export function VariationPicker({
  type,
  value,
  onChange,
  allowNone,
  onZoom,
  disabled,
  disabledReason,
}: {
  type: VariationType;
  value: string;
  onChange: (v: string) => void;
  allowNone: boolean;
  onZoom: (url: string) => void;
  disabled: Set<string>;
  disabledReason: Record<string, string>;
}) {
  const reason = (id: string) => (disabledReason[id] ? `Not compatible with ${disabledReason[id]}` : "Not compatible with your current selection");
  const hasImages = type.items.some((i) => i.image);
  if (!hasImages) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-ink"
      >
        {allowNone && <option value="">— None —</option>}
        {type.items.map((it) => {
          const off = disabled.has(it.id);
          return (
            <option key={it.id} value={it.id} disabled={off}>
              {it.name}{it.price ? ` (+${usd(it.price)})` : ""}{off ? " — unavailable with current selection" : ""}
            </option>
          );
        })}
      </select>
    );
  }
  const cardCx = (sel: boolean, off: boolean) =>
    cx(
      "relative w-24 shrink-0 rounded-xl border p-1.5 text-left transition-colors",
      off ? "cursor-not-allowed border-line opacity-40" : sel ? "border-ink ring-2 ring-ink/15" : "border-line hover:border-ink"
    );
  return (
    <div className="flex flex-wrap gap-2">
      {allowNone && (
        <button type="button" onClick={() => onChange("")} className={cx(cardCx(value === "", false), "flex h-[104px] items-center justify-center text-[12px] text-muted")}>
          None
        </button>
      )}
      {type.items.map((it) => {
        const sel = value === it.id;
        const off = disabled.has(it.id);
        return (
          <button
            key={it.id}
            type="button"
            disabled={off}
            onClick={() => !off && onChange(it.id)}
            title={off ? reason(it.id) : undefined}
            className={cardCx(sel, off)}
          >
            <div className="relative">
              {it.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.image} alt={it.name} className="h-16 w-full rounded-lg bg-[#0e0e10] object-contain p-1" />
              ) : (
                <div className="h-16 w-full rounded-lg bg-[#f1efe9]" />
              )}
              {it.image && !off && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); onZoom(it.image!); }}
                  className="absolute right-0.5 top-0.5 rounded-md bg-black/55 px-1 text-[10px] text-white"
                  title="Enlarge"
                >
                  🔍
                </span>
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

/** Add a product to a quote — qty + any variation choices (Crown+Drive paired), capped at stock. */
export function AddAccessoryButton({
  modelId,
  quoteId,
  stock,
  variations = [],
  availableItemIds = [],
  defaultItemIds = [],
  restrictions = [],
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
  /** item↔item incompatibility pairs (selecting one greys out the other) */
  restrictions?: VariationRestriction[];
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

  // Variation types available for this product (only assigned items), grouped.
  const avail = useMemo(
    () =>
      variations
        .map((t) => ({ ...t, items: t.items.filter((i) => availableItemIds.includes(i.id)) }))
        .filter((t) => t.items.length > 0),
    [variations, availableItemIds]
  );
  const pairGroups = useMemo(() => {
    const m = new Map<string, VariationType[]>();
    for (const t of avail) if (t.pairGroup) (m.get(t.pairGroup) ?? m.set(t.pairGroup, []).get(t.pairGroup)!).push(t);
    return [...m.values()];
  }, [avail]);
  const independents = useMemo(() => avail.filter((t) => !t.pairGroup), [avail]);
  const hasVariations = avail.length > 0;

  // Selection state: a chosen item per type ("" = none), plus a per-group on/off toggle.
  // Seeded from the product's admin-set defaults (e.g. AM25 → a specific Crown + Drive).
  const [pick, setPick] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      avail.map((t) => {
        const def = t.items.find((i) => defaultItemIds.includes(i.id));
        return [t.id, def ? def.id : t.pairGroup ? t.items[0]?.id ?? "" : ""];
      })
    )
  );
  const [groupOn, setGroupOn] = useState<Record<string, boolean>>(() => {
    const on: Record<string, boolean> = {};
    for (const t of avail) if (t.pairGroup && t.items.some((i) => defaultItemIds.includes(i.id))) on[t.pairGroup] = true;
    return on;
  });

  // Bidirectional incompatibility map: item id → set of item ids it can't be combined with.
  const blocked = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
    for (const r of restrictions) { add(r.itemLo, r.itemHi); add(r.itemHi, r.itemLo); }
    return m;
  }, [restrictions]);
  const itemName = useMemo(() => {
    const n: Record<string, string> = {};
    for (const t of avail) for (const i of t.items) n[i.id] = i.name;
    return n;
  }, [avail]);

  // A type's pick only "counts" for conflicts when it's actually in play (independent, or its
  // paired group is toggled on). This is also what's collected at submit time.
  const activePick = (t: VariationType): string => {
    if (t.pairGroup && !groupOn[t.pairGroup]) return "";
    return pick[t.id] ?? "";
  };

  // Items of `type` that conflict with another type's active pick → greyed out, with the
  // conflicting option's name for the tooltip.
  const disabledFor = (type: VariationType): { ids: Set<string>; reason: Record<string, string> } => {
    const ids = new Set<string>();
    const reason: Record<string, string> = {};
    for (const other of avail) {
      if (other.id === type.id) continue;
      const chosen = activePick(other);
      if (!chosen) continue;
      const conflicts = blocked.get(chosen);
      if (!conflicts) continue;
      for (const it of type.items) if (conflicts.has(it.id)) { ids.add(it.id); reason[it.id] = itemName[chosen] ?? "your current selection"; }
    }
    return { ids, reason };
  };

  // Pick an item, then drop any now-incompatible pick in another type so the user is never
  // wedged into an invalid pair (the conflicting side clears and re-opens for a fresh choice).
  const choose = (typeId: string, itemId: string) =>
    setPick((prev) => {
      const next = { ...prev, [typeId]: itemId };
      if (itemId) {
        const conflicts = blocked.get(itemId);
        if (conflicts) {
          for (const other of avail) {
            if (other.id === typeId) continue;
            if (other.pairGroup && !groupOn[other.pairGroup]) continue;
            if (next[other.id] && conflicts.has(next[other.id])) next[other.id] = "";
          }
        }
      }
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
          window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
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

  const collectIds = (): string[] => {
    const ids: string[] = [];
    for (const group of pairGroups) {
      const key = group[0].pairGroup!;
      if (groupOn[key]) for (const t of group) if (pick[t.id]) ids.push(pick[t.id]);
    }
    for (const t of independents) if (pick[t.id]) ids.push(pick[t.id]);
    return ids;
  };

  const onAdd = () => {
    if (hasVariations) setModal(true);
    else submit([]);
  };

  const confirmModal = () => {
    // Paired groups: if on, every type must have a pick (dropdowns default to the first item).
    for (const group of pairGroups) {
      const key = group[0].pairGroup!;
      if (groupOn[key] && group.some((t) => !pick[t.id])) {
        setError(`Pick a ${group.map((t) => t.name).join(" and ")}`);
        return;
      }
    }
    submit(collectIds());
  };

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
              {/* paired groups (Crown + Drive) — added together or not at all */}
              {pairGroups.map((group) => {
                const key = group[0].pairGroup!;
                const on = !!groupOn[key];
                const title = group.map((t) => t.name).join(" + ");
                return (
                  <div key={key} className="rounded-xl border border-line p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                      <input type="checkbox" checked={on} onChange={(e) => setGroupOn((g) => ({ ...g, [key]: e.target.checked }))} />
                      Add {title}
                    </label>
                    {on && (
                      <div className="mt-3 space-y-3">
                        {group.map((t) => {
                          const d = disabledFor(t);
                          return (
                            <div key={t.id}>
                              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                              <VariationPicker type={t} value={pick[t.id] ?? ""} onChange={(v) => choose(t.id, v)} allowNone={false} onZoom={setZoom} disabled={d.ids} disabledReason={d.reason} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* independent variations — each optional */}
              {independents.map((t) => {
                const d = disabledFor(t);
                return (
                  <div key={t.id}>
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                    <VariationPicker type={t} value={pick[t.id] ?? ""} onChange={(v) => choose(t.id, v)} allowNone onZoom={setZoom} disabled={d.ids} disabledReason={d.reason} />
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
