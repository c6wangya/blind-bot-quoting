"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MessageItemRef, VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { availableTypes, buildBlockedFromGroups, buildItemNames, disabledFor } from "@/lib/variation-logic";
import { useToast } from "./Toast";
import { Button, cx } from "./ui";

/** A catalog model flattened for the client browser (everything the list rows + panel need). */
export type BrowserModel = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  image: string | null;
  /** effective price; null = "Incl." (not separately priced) */
  price: number | null;
  /** tracked stock; null = untracked (unlimited) */
  stock: number | null;
  moq: number;
  categoryName: string;
  orderable: boolean;
  tags: string[];
  files: { id: string; url: string; kind: string; name: string }[];
  availableItemIds: string[];
  defaultItemIds: string[];
};

/** An open (draft) quote offered in the in-page "Add to quote" picker. */
export type QuoteOpt = { id: number; ref: string; quoteName: string | null; projectName: string | null; itemCount: number; items: MessageItemRef[] };

/** One unified, full-height panel: a summary list (left) glued to a detail + configure pane
 *  (right). The page constrains the height; both sides scroll internally. */
export function AccessoryBrowser({
  models,
  variations,
  exclusionGroups,
  variationStock,
  itemModelMap,
  quotes,
  preselectedQuoteId,
  showCategory,
}: {
  models: BrowserModel[];
  variations: VariationType[];
  /** model_id → exclusion groups (each a list of item ids; at most one per group is pickable). */
  exclusionGroups: Record<string, string[][]>;
  /** add-on part item id → stock (null = untracked) */
  variationStock: Record<string, number | null>;
  /** add-on part item id → its source catalog model id, ONLY for parts whose model is in an
   *  orderable category (present = the part can be bought on its own; mirrors the server guard) */
  itemModelMap: Record<string, string>;
  /** the user's open draft quotes (for the in-page picker) */
  quotes: QuoteOpt[];
  /** arrived here from a specific quote (?quote=<id>): skip the picker and add straight to it */
  preselectedQuoteId?: number;
  /** show each row's category name (filtering across categories) */
  showCategory: boolean;
}) {
  const firstSelectable = models.find((m) => m.orderable && m.price !== null)?.id ?? null;
  // Deep link from elsewhere (e.g. an order line) can preselect a row via ?sel=<modelId>.
  const initialSel = useSearchParams().get("sel");
  // undefined → use default (first); null → explicitly closed; string → user pick.
  const [picked, setPicked] = useState<string | null | undefined>(initialSel ?? undefined);
  const selectedId =
    picked === null ? null : picked && models.some((m) => m.id === picked) ? picked : firstSelectable;
  const selected = selectedId ? models.find((m) => m.id === selectedId) ?? null : null;

  // On a deep-linked open, bring the preselected row into view (the list scrolls internally).
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!initialSel) return;
    listRef.current?.querySelector(`[data-model-id="${initialSel}"]`)?.scrollIntoView({ block: "center" });
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-[650px] overflow-hidden rounded-2xl border border-line bg-surface">
      {/* Summary list */}
      <div className={cx("min-w-0 overflow-y-auto", selected ? "flex-1" : "flex-1")}>
        {models.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted">No models match these filters.</div>
        ) : (
          <ul ref={listRef} className="divide-y divide-line/70">
            {models.map((m) => {
              const active = m.id === selectedId;
              const selectable = m.orderable && m.price !== null;
              return (
                <li
                  key={m.id}
                  data-model-id={m.id}
                  onClick={() => selectable && setPicked(m.id)}
                  className={cx(
                    "relative flex items-center gap-3.5 px-4 py-3 transition-colors",
                    selectable ? "cursor-pointer" : "cursor-default",
                    active ? "bg-[#fbf8f1]" : selectable ? "hover:bg-[#faf9f5]" : ""
                  )}
                >
                  {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-brass" />}
                  {m.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image} alt={m.name} className="size-11 shrink-0 rounded-lg bg-[#0e0e10] object-contain p-1" />
                  ) : (
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#0e0e10] text-[9px] font-medium text-white/40">
                      No image
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[13.5px] font-semibold leading-snug text-ink">{m.name}</span>
                      {m.moq > 0 && (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800">MOQ {m.moq}</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                      <span className="font-mono">{m.sku}</span>
                      {showCategory && <span>· {m.categoryName}</span>}
                    </div>
                    {selectable && m.stock !== null && (
                      <div
                        className={cx(
                          "mt-0.5 text-[11px]",
                          m.stock <= 0 ? "font-medium text-red-500" : m.stock <= 5 ? "text-amber-600" : "text-muted"
                        )}
                      >
                        {m.stock <= 0 ? "Out of stock" : m.stock <= 5 ? `Only ${m.stock} left` : `${m.stock} in stock`}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[14px] font-semibold tabular-nums text-ink">{m.price === null ? "Incl." : usd(m.price)}</div>
                    {!selectable && <div className="mt-0.5 text-[11px] text-muted">Reference</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Detail + configure pane */}
      {selected && (
        <div className="flex flex-[1.4] min-w-0 flex-col border-l border-line">
          <VariationPanel
            exclusionGroups={exclusionGroups}
            key={selected.id}
            model={selected}
            variations={variations}
            variationStock={variationStock}
            itemModelMap={itemModelMap}
            quotes={quotes}
            preselectedQuoteId={preselectedQuoteId}
            onClose={() => setPicked(null)}
          />
        </div>
      )}
    </div>
  );
}

/** Stepper used for both the motor quantity and each sub-part's per-motor quantity. */
function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center rounded-lg border border-line">
      <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease" className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30">
        −
      </button>
      <input
        type="number"
        min={min}
        max={Number.isFinite(max) ? max : undefined}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") { onChange(min); return; }
          const n = Math.floor(Number(v));
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        onBlur={(e) => {
          const n = Math.floor(Number(e.target.value));
          onChange(Number.isNaN(n) ? min : Math.min(max, Math.max(min, n)));
        }}
        aria-label="Quantity"
        className="w-11 border-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase" className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30">
        +
      </button>
    </div>
  );
}

function VariationPanel({
  model,
  variations,
  exclusionGroups,
  variationStock,
  itemModelMap,
  quotes,
  preselectedQuoteId,
  onClose,
}: {
  model: BrowserModel;
  variations: VariationType[];
  exclusionGroups: Record<string, string[][]>;
  variationStock: Record<string, number | null>;
  itemModelMap: Record<string, string>;
  quotes: QuoteOpt[];
  preselectedQuoteId?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const minQty = Math.max(1, model.moq);
  const tracked = model.stock !== null;
  const outOfStock = tracked && model.stock === 0;
  const maxQty = tracked ? (model.stock as number) : Infinity;

  const [motorQty, setMotorQty] = useState(minQty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Inline "Create new quote" form inside the picker: name is optional.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  // Preselected quote starts expanded so its items are visible right away; the chevron still toggles.
  const [expandedQuote, setExpandedQuote] = useState<number | null>(preselectedQuoteId ?? null);
  const [descOpen, setDescOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  // "Buy on its own": when set, the quote picker adds THIS single part (its own catalog model) as a
  // standalone line instead of the configured motor + kit. null = normal motor mode.
  const [alone, setAlone] = useState<{ name: string; modelId: string; stock: number | null } | null>(null);
  const [aloneQty, setAloneQty] = useState(1);

  const avail = useMemo(() => availableTypes(variations, model.availableItemIds), [variations, model.availableItemIds]);
  const blocked = useMemo(() => buildBlockedFromGroups(exclusionGroups[model.id] ?? []), [exclusionGroups, model.id]);
  const itemName = useMemo(() => buildItemNames(avail), [avail]);
  const priceOf = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of avail) for (const i of t.items) m[i.id] = i.price;
    return m;
  }, [avail]);

  // Multi-select per type: each type holds a list of chosen item ids ([] = none). Initial state
  // seeds ONLY the admin-configured defaults (customer kit → store-wide star). No fallback: a
  // type with no default starts unselected. The user can add/clear any of them.
  const [pick, setPick] = useState<Record<string, string[]>>(() => {
    const p: Record<string, string[]> = {};
    const chosen = new Set<string>(); // already-seeded ids, for the exclusion-group check
    const compatible = (id: string) => {
      const c = blocked.get(id);
      if (!c) return true;
      for (const x of chosen) if (c.has(x)) return false;
      return true;
    };
    for (const t of avail) {
      const ids: string[] = [];
      for (const i of t.items)
        if (model.defaultItemIds.includes(i.id) && compatible(i.id)) {
          ids.push(i.id);
          chosen.add(i.id);
        }
      p[t.id] = ids;
    }
    return p;
  });
  const [itemQty, setItemQty] = useState<Record<string, number>>({});
  const qtyOf = (itemId: string) => itemQty[itemId] ?? 1;
  const setQty = (itemId: string, v: number) => setItemQty((p) => ({ ...p, [itemId]: v }));

  // Add-on part stock: undefined/null = untracked (unlimited).
  const stockOf = (id: string): number | null => {
    const s = variationStock[id];
    return s === undefined ? null : s;
  };

  // Toggle an item within a type (multi-select). Adding an item drops any currently-selected item
  // (in any type) that shares an exclusion group with it. Out-of-stock items can't be picked.
  const toggle = (typeId: string, itemId: string) => {
    setPick((prev) => {
      const cur = prev[typeId] ?? [];
      if (cur.includes(itemId)) return { ...prev, [typeId]: cur.filter((x) => x !== itemId) };
      if ((stockOf(itemId) ?? Infinity) <= 0) return prev;
      const conflicts = blocked.get(itemId);
      const next: Record<string, string[]> = {};
      for (const [tid, ids] of Object.entries(prev)) next[tid] = conflicts ? ids.filter((id) => !conflicts.has(id)) : ids;
      next[typeId] = [...(next[typeId] ?? []), itemId];
      return next;
    });
  };
  const clearType = (typeId: string) => setPick((prev) => ({ ...prev, [typeId]: [] }));

  // Currently picked item ids, flattened across all types.
  const selectedIds = avail.flatMap((t) => pick[t.id] ?? []);
  const selectedSet = new Set(selectedIds);

  // A picked part whose total need (motorQty × per-motor qty) exceeds its stock.
  const oversold = useMemo(() => {
    const set = new Set<string>();
    for (const id of selectedIds) {
      const s = variationStock[id];
      if (s !== undefined && s !== null && motorQty * (itemQty[id] ?? 1) > s) set.add(id);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, motorQty, itemQty, variationStock]);

  const base = model.price ?? 0;
  const addon = selectedIds.reduce((s, id) => s + (priceOf[id] ?? 0) * qtyOf(id), 0);
  const unitPrice = base + addon;
  const lineTotal = unitPrice * motorQty;

  const labelOf = (q: QuoteOpt) => q.quoteName || q.ref;
  const refOf = (id: number) => {
    const q = quotes.find((x) => x.id === id);
    return q ? labelOf(q) : "quote";
  };

  // Add to an existing quote — stay on the page so the user can keep shopping. `aloneOverride`
  // lets a row add its part straight to a preselected quote without waiting on `alone` state.
  const doAdd = async (
    targetId: number,
    aloneOverride?: { name: string; modelId: string; stock: number | null }
  ) => {
    const a = aloneOverride ?? alone;
    const q = aloneOverride ? 1 : aloneQty;
    if (a) {
      if (a.stock !== null && q > a.stock) return;
    } else if (oversold.size > 0) return;
    setMenuOpen(false);
    setBusy(true);
    setError(null);
    try {
      // Standalone part → its own catalog model, no variationItems. Motor → model + kit.
      const body = a
        ? { productId: a.modelId, qty: q, quoteId: targetId }
        : {
            productId: model.id,
            qty: motorQty,
            quoteId: targetId,
            variationItems: selectedIds.map((id) => ({ itemId: id, qty: qtyOf(id) })),
          };
      const r = await fetch("/api/quote-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not add to quote");
      setBusy(false);
      toast(`Added ${a ? a.name : model.name} to ${refOf(targetId)}`);
      setAlone(null);
      router.refresh(); // refresh the draft list (item counts) without leaving the page
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  // A part row's "Add on its own": buy just this part (its source catalog model), not the motor.
  // Opens the SAME footer popover as a normal add — with a qty stepper — so quantity is editable.
  // Preselected quote: the popover is just "part + qty" and the footer button confirms it (no quote
  // list, no second CTA). Otherwise it also lists the quotes to pick/create.
  const openAddAlone = (name: string, modelId: string, stock: number | null) => {
    setError(null);
    setCreating(false);
    setNewName("");
    setAlone({ name, modelId, stock });
    setAloneQty(1);
    setMenuOpen(true);
  };

  // Create a new (optionally named) empty draft, then silently refresh so it appears at the top of
  // the picker — the item is NOT added automatically; the user adds it from the list afterwards.
  const createQuote = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = newName.trim();
      const cr = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Pre-fill the new quote with the retailer's default address (if any).
        body: JSON.stringify({ quoteName: name || null, useDefaultAddress: true }),
      });
      if (cr.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      const crData = await cr.json();
      if (!cr.ok) throw new Error(crData.error ?? "Could not create quote");
      setBusy(false);
      // Keep the picker open so the freshly-created quote appears at the top of the list.
      setCreating(false);
      setNewName("");
      toast(`Created ${name || crData.quote.ref}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const TAG_LIMIT = 6;
  const shownTags = tagsOpen ? model.tags : model.tags.slice(0, TAG_LIMIT);
  const COLLAPSE = 150;
  const desc = model.description ?? "";
  const longDesc = desc.length > COLLAPSE;

  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-line/70 p-4">
        {model.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={model.image} alt={model.name} className="size-16 shrink-0 rounded-xl bg-[#0e0e10] object-contain p-1.5" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-snug text-ink">{model.name}</div>
          <div className="mt-1 font-mono text-[11px] text-ink-soft">{model.sku}</div>
          <div className="mt-1 text-[14px] font-semibold tabular-nums text-ink">
            {usd(base)} <span className="text-[11px] font-normal text-muted">/ unit</span>
          </div>
        </div>
        <button onClick={onClose} className="shrink-0 text-muted hover:text-ink" aria-label="Close">
          ✕
        </button>
      </div>

      {outOfStock ? (
        <div className="flex-1 p-4 text-center text-[12px] font-medium text-red-500">Out of stock</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* Details — description clamps inline */}
          {desc && (
            <p className="text-[12.5px] leading-relaxed text-muted">
              {descOpen || !longDesc ? desc : `${desc.slice(0, COLLAPSE).trimEnd()}… `}
              {longDesc && (
                <button onClick={() => setDescOpen((o) => !o)} className="font-medium text-brass hover:underline">
                  {descOpen ? " Show less" : "Show more"}
                </button>
              )}
            </p>
          )}

          {model.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {shownTags.map((t, i) => (
                <span key={i} className="rounded-md bg-brass-soft px-1.5 py-0.5 text-[10.5px] font-medium text-[#8a6a39]">
                  {t}
                </span>
              ))}
              {model.tags.length > TAG_LIMIT && (
                <button onClick={() => setTagsOpen((s) => !s)} className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted hover:text-ink">
                  {tagsOpen ? "Show less" : `+${model.tags.length - TAG_LIMIT} more`}
                </button>
              )}
            </div>
          )}

          {model.files.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {model.files.map((f) => (
                <a
                  key={f.id}
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft hover:border-ink"
                >
                  📄 {f.kind === "certification" ? "Cert" : f.kind === "spec" ? "Spec" : "Doc"}: {f.name}
                </a>
              ))}
            </div>
          )}

          {/* Add-on parts — one pick per type (互斥-aware), borderless rows */}
          {avail.length > 0 && (
            <div className="mt-5 space-y-4">
              <div className="border-t border-line/70 pt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Add-on parts</span>
                  <span className="text-[10.5px] text-muted">Qty is per motor</span>
                </div>
                <p className="mt-1 text-[10.5px] leading-snug text-muted">
                  Tick a part to bundle it with the motor · <span className="font-medium text-ink-soft">Add alone</span> orders just that part.
                </p>
              </div>

              {avail.map((t) => {
                const d = disabledFor(t, selectedSet, blocked, itemName);
                const sel = pick[t.id] ?? [];
                return (
                  <div key={t.id}>
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                      {sel.length > 0 && (
                        <button onClick={() => clearType(t.id)} className="text-[10.5px] font-medium text-muted hover:text-ink">
                          Clear
                        </button>
                      )}
                    </div>
                    <div>
                      {t.items.map((it) => {
                        const selected = sel.includes(it.id);
                        return (
                          <OptionRow
                            key={it.id}
                            item={it}
                            selected={selected}
                            disabled={d.ids.has(it.id) && !selected}
                            reason={d.reason[it.id]}
                            stock={stockOf(it.id)}
                            oversold={oversold.has(it.id)}
                            qty={qtyOf(it.id)}
                            canAlone={!!itemModelMap[it.id]}
                            onAddAlone={() => openAddAlone(it.name, itemModelMap[it.id], stockOf(it.id))}
                            onToggle={() => toggle(t.id, it.id)}
                            onQty={(n) => setQty(it.id, n)}
                            onZoom={setZoom}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer — motor qty + live total + add */}
      {!outOfStock && (
        <div className="border-t border-line/70 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Quantity</div>
              {model.moq > 0 && <div className="mt-0.5 text-[10.5px] text-amber-700">Min order {model.moq}</div>}
            </div>
            <Stepper value={motorQty} min={minQty} max={maxQty} onChange={setMotorQty} />
          </div>

          <div className="mt-3 flex items-end justify-between border-t border-dashed border-line/70 pt-3">
            <div>
              <div className="text-[11px] text-muted">
                {motorQty} × {usd(unitPrice)}
                {addon > 0 && <span className="text-muted"> (incl. {usd(addon)} parts)</span>}
              </div>
              <div className="text-[17px] font-semibold tabular-nums text-ink">{usd(lineTotal)}</div>
            </div>
          </div>

          {oversold.size > 0 && (
            <p className="mt-2 text-[11px] text-red-500">Some add-on parts exceed available stock — reduce the quantity.</p>
          )}
          {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}

          <div className="relative mt-3">
            <Button
              variant="primary"
              onClick={() => {
                // Opener for both flows: reveal the quote (with its current items) so it can be
                // reviewed before adding. The motor is a lone-part-free add.
                setAlone(null);
                setCreating(false);
                setNewName("");
                setMenuOpen((o) => !o);
              }}
              busy={busy}
              disabled={oversold.size > 0}
              className="w-full justify-center py-2.5"
            >
              {preselectedQuoteId != null ? `Add to ${refOf(preselectedQuoteId)}` : "Add to quote"}
            </Button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => {
                    setMenuOpen(false);
                    setCreating(false);
                    setNewName("");
                    setAlone(null);
                  }}
                  aria-hidden
                />
                <div className="absolute bottom-full right-0 z-40 mb-2 max-h-80 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
                  {alone && (
                    <div className={cx("px-2 pb-2 pt-1.5", preselectedQuoteId == null && "border-b border-line/70")}>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brass">Adding a part on its own</div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[12.5px] font-medium text-ink">{alone.name}</span>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Stepper value={aloneQty} min={1} max={alone.stock ?? 999} onChange={setAloneQty} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 px-2 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {preselectedQuoteId != null
                        ? alone
                          ? "Add this part to"
                          : "Add to"
                        : alone
                          ? "Add to which quote?"
                          : quotes.length > 0
                            ? "Add to existing"
                            : "Your quotes"}
                    </span>
                    {!creating && preselectedQuoteId == null && (
                      <button
                        onClick={() => setCreating(true)}
                        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-ink transition-colors hover:bg-[#faf9f5]"
                      >
                        <span className="text-[14px] leading-none text-brass">＋</span> Create
                      </button>
                    )}
                  </div>
                  {creating && (
                    <div className="flex items-center gap-1.5 px-2 pb-2 pt-0.5">
                      <input
                        autoFocus
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") createQuote();
                          if (e.key === "Escape") {
                            setCreating(false);
                            setNewName("");
                          }
                        }}
                        placeholder="Quote name (optional)"
                        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
                      />
                      <Button
                        variant="primary"
                        busy={busy}
                        onClick={createQuote}
                        className="shrink-0 px-3 py-1.5 text-[13px]"
                      >
                        Create
                      </Button>
                    </div>
                  )}
                  {(preselectedQuoteId != null
                    ? quotes.filter((q) => q.id === preselectedQuoteId)
                    : quotes
                  ).map((qu) => {
                    const open = expandedQuote === qu.id;
                    return (
                      <div key={qu.id}>
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => doAdd(qu.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[#faf9f5]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium text-ink">{labelOf(qu)}</span>
                              <span className="block truncate text-[11px] text-muted">
                                {qu.quoteName ? `${qu.ref} · ` : ""}
                                {qu.itemCount} item{qu.itemCount === 1 ? "" : "s"}
                              </span>
                            </span>
                          </button>
                          {qu.items.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedQuote(open ? null : qu.id)}
                              aria-label={open ? "Hide items" : "Show items"}
                              aria-expanded={open}
                              className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-[#f4f2ec] hover:text-ink"
                            >
                              <svg
                                viewBox="0 0 16 16"
                                className={cx("size-3.5 transition-transform", open && "rotate-180")}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.75"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                              >
                                <path d="M4 6l4 4 4-4" />
                              </svg>
                            </button>
                          )}
                        </div>
                        {open && qu.items.length > 0 && (
                          <ul className="mb-1 ml-2.5 mr-1 space-y-1 rounded-lg border border-line/70 bg-[#faf9f5] px-2.5 py-2">
                            {qu.items.map((it, i) => (
                              <li
                                key={i}
                                className={cx("flex items-center gap-2 text-[11.5px] leading-snug", it.sub && "pl-3")}
                              >
                                <span className="min-w-0 flex-1 truncate text-ink-soft">
                                  {it.sub && <span className="text-muted">↳ </span>}
                                  {it.name}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted">×{it.qty}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-8" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-xl bg-[#0e0e10] object-contain p-2" />
        </div>
      )}
    </>
  );
}

/** One add-on part: a borderless checkbox row (thumbnail · name · price) that reveals an inline
 *  per-motor qty stepper when checked. Incompatible options grey out. */
function OptionRow({
  item,
  selected,
  disabled,
  reason,
  stock,
  oversold,
  qty,
  canAlone,
  onAddAlone,
  onToggle,
  onQty,
  onZoom,
}: {
  item: VariationType["items"][number];
  selected: boolean;
  disabled: boolean;
  reason?: string;
  /** available stock; null = untracked */
  stock: number | null;
  oversold: boolean;
  qty: number;
  /** the part is backed by its own catalog model → it can be bought on its own */
  canAlone: boolean;
  onAddAlone: () => void;
  onToggle: () => void;
  onQty: (n: number) => void;
  onZoom: (url: string) => void;
}) {
  const outOfStock = stock !== null && stock <= 0;
  const blocked = disabled || (outOfStock && !selected);
  return (
    <div
      onClick={() => !blocked && onToggle()}
      title={
        disabled
          ? `Not compatible with ${reason ?? "your current selection"}`
          : outOfStock
            ? "Out of stock"
            : undefined
      }
      className={cx(
        "group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
        blocked ? "cursor-not-allowed opacity-40" : selected ? "cursor-pointer bg-[#fbf8f1]" : "cursor-pointer hover:bg-[#faf9f5]"
      )}
    >
      {/* Square checkbox (multi-select): several items per type can be chosen. */}
      <span className={cx("flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border", selected ? "border-ink bg-ink" : "border-line")}>
        {selected && (
          <svg viewBox="0 0 24 24" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
      {item.image ? (
        <div className="relative shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.image} alt={item.name} className="size-10 rounded-lg bg-[#0e0e10] object-contain p-0.5" />
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); if (item.image) onZoom(item.image); }}
            className="absolute -right-1 -top-1 rounded bg-black/55 px-1 text-[9px] text-white"
            title="Enlarge"
          >
            🔍
          </span>
        </div>
      ) : (
        <div className="size-10 shrink-0 rounded-lg bg-[#f1efe9]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium leading-snug text-ink">{item.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          {item.price ? <span>+{usd(item.price)} ea</span> : null}
          {outOfStock ? (
            <span className="font-medium text-red-500">Out of stock</span>
          ) : stock !== null ? (
            <span className={cx(oversold ? "font-medium text-red-500" : stock <= 5 ? "text-amber-600" : "")}>
              {oversold ? `Only ${stock} left` : `${stock} in stock`}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* Buy on its own — independent of the motor / of kit compatibility. Hidden only when the
            part has no catalog model to sell or is out of stock. */}
        {canAlone && !outOfStock && (
          <button
            type="button"
            onClick={onAddAlone}
            title="Add just this part to a quote — on its own, not with the motor"
            className="rounded-md border border-line px-2 py-1 text-[10.5px] font-medium text-muted transition-colors hover:border-ink hover:text-ink group-hover:text-ink-soft"
          >
            ＋ Add alone
          </button>
        )}
        {selected && <Stepper value={qty} min={1} max={stock !== null ? stock : 999} onChange={onQty} />}
      </div>
    </div>
  );
}
