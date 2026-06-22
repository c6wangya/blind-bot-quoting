"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { stashPendingItem } from "@/lib/pending-item";
import type { VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { Button, cx } from "./ui";

/** Pick one item of a variation. Items with images render as visual cards (tap 🔍 to zoom);
 *  otherwise a text dropdown. `allowNone` adds a "None" choice (independent variations). */
function VariationPicker({
  type,
  value,
  onChange,
  allowNone,
  onZoom,
}: {
  type: VariationType;
  value: string;
  onChange: (v: string) => void;
  allowNone: boolean;
  onZoom: (url: string) => void;
}) {
  const hasImages = type.items.some((i) => i.image);
  if (!hasImages) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-ink"
      >
        {allowNone && <option value="">— None —</option>}
        {type.items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.name}{it.price ? ` (+${usd(it.price)})` : ""}
          </option>
        ))}
      </select>
    );
  }
  const cardCx = (sel: boolean) =>
    cx("relative w-24 shrink-0 rounded-xl border p-1.5 text-left transition-colors", sel ? "border-ink ring-2 ring-ink/15" : "border-line hover:border-ink");
  return (
    <div className="flex flex-wrap gap-2">
      {allowNone && (
        <button type="button" onClick={() => onChange("")} className={cx(cardCx(value === ""), "flex h-[104px] items-center justify-center text-[12px] text-muted")}>
          None
        </button>
      )}
      {type.items.map((it) => {
        const sel = value === it.id;
        return (
          <button key={it.id} type="button" onClick={() => onChange(it.id)} className={cardCx(sel)}>
            <div className="relative">
              {it.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.image} alt={it.name} className="h-16 w-full rounded-lg bg-[#0e0e10] object-contain p-1" />
              ) : (
                <div className="h-16 w-full rounded-lg bg-[#f1efe9]" />
              )}
              {it.image && (
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
}) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
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

  const tracked = stock !== null && stock !== undefined;
  const outOfStock = tracked && stock === 0;
  const max = tracked ? (stock as number) : 500;

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
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity" className="px-2.5 py-1 text-ink-soft hover:text-ink">
            −
          </button>
          <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
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
                        {group.map((t) => (
                          <div key={t.id}>
                            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                            <VariationPicker type={t} value={pick[t.id] ?? ""} onChange={(v) => setPick((p) => ({ ...p, [t.id]: v }))} allowNone={false} onZoom={setZoom} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* independent variations — each optional */}
              {independents.map((t) => (
                <div key={t.id}>
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                  <VariationPicker type={t} value={pick[t.id] ?? ""} onChange={(v) => setPick((p) => ({ ...p, [t.id]: v }))} allowNone onZoom={setZoom} />
                </div>
              ))}
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
