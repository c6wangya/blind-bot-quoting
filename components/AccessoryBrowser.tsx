"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AccessoryModelNote, MessageItemRef, VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { availableTypes } from "@/lib/variation-logic";
import { AccessoryNoteButton } from "./AccessoryNoteButton";
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
  /** Compatible-variation entries: each a named + imaged fitment group of catalog items (by category). */
  compat: {
    id: string;
    name: string;
    imageUrl: string | null;
    groups: { category: string; items: { id: string; name: string; sku: string; imageUrl: string | null }[] }[];
  }[];
  files: { id: string; url: string; kind: string; name: string }[];
  availableItemIds: string[];
  defaultItemIds: string[];
};

/** An open (draft) quote offered in the in-page "Add to quote" picker. */
export type QuoteOpt = { id: number; ref: string; quoteName: string | null; projectName: string | null; itemCount: number; items: MessageItemRef[] };

/** Compact "Compatible with" hint shown next to a part; hovering opens a popover that lists each
 *  compatible-variation entry (name + image) and, under it, the fitting catalog parts (by category)
 *  each with a thumbnail. The popover is position:fixed so the scrollable list never clips it. */
function CompatBadge({ modelName, compat }: { modelName: string; compat: BrowserModel["compat"] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const W = 300;
  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    let left = r.right + 8;
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - 8);
    const top = Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - 372));
    setPos({ top, left });
  };
  return (
    <span
      ref={ref}
      className="relative mt-1 inline-flex"
      onMouseEnter={open}
      onMouseLeave={() => setPos(null)}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-[#c9d3e6] bg-[#eef1f6] px-2 py-0.5 text-[10.5px] font-semibold text-[#3a465c]">
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M6 8.5 7.3 10 10.5 6M8 1.5l5.5 2v3.7c0 3.2-2.2 5.6-5.5 7.3-3.3-1.7-5.5-4.1-5.5-7.3V3.5z" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        Compatible with
      </span>
      {pos && (
        <div
          className="fixed z-50 w-[300px] max-h-[364px] overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-xl"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="mb-2 flex items-baseline gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Compatible with</span>
            <span className="text-[11px] font-medium text-ink">{modelName}</span>
          </div>
          <div className="space-y-2.5">
            {compat.map((c) => (
              <div key={c.id}>
                <div className="flex items-center gap-1.5">
                  {c.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.imageUrl} alt="" className="size-6 shrink-0 rounded bg-[#0e0e10] object-contain p-0.5" />
                  )}
                  <span className="text-[12px] font-semibold text-ink">{c.name || "Variation"}</span>
                </div>
                {c.groups.map((g, gi) => (
                  <div key={gi} className="mt-1 pl-1">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{g.category}</div>
                    <div className="mt-0.5 space-y-0.5">
                      {g.items.map((it) => (
                        <div key={it.id} className="flex items-start gap-1.5">
                          {it.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={it.imageUrl} alt="" className="size-6 shrink-0 rounded bg-[#0e0e10] object-contain p-0.5" />
                          ) : (
                            <span className="size-6 shrink-0 rounded bg-[#0e0e10]" />
                          )}
                          <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink">{it.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

/** One unified, full-height panel: a summary list (left) glued to a detail + configure pane
 *  (right). The page constrains the height; both sides scroll internally. */
export function AccessoryBrowser({
  models,
  variations,
  exclusionGroups,
  variationStock,
  itemModelMap,
  itemModelAll,
  itemModelCat,
  itemCompat,
  notesMap,
  isAdmin,
  canAirFreight,
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
  /** add-on part item id → its source catalog model id, for ALL parts (used to key the fitment note) */
  itemModelAll: Record<string, string>;
  /** related-part item id → its source model's category id (deep-link to that part's own detail) */
  itemModelCat: Record<string, string>;
  /** add-on part item id → its source model's compatible-variation entries (present only if any) */
  itemCompat: Record<string, BrowserModel["compat"]>;
  /** model_id → its retailer-facing compatibility note (free text + images); absent = no note */
  notesMap: Record<string, AccessoryModelNote>;
  /** the viewer is an admin → can edit fitment notes (else read-only, shown only when a note exists) */
  isAdmin: boolean;
  /** admin acting on a retailer's behalf → may place air-freight (from China) orders for out-of-stock models */
  canAirFreight: boolean;
  /** the user's open draft quotes (for the in-page picker) */
  quotes: QuoteOpt[];
  /** arrived here from a specific quote (?quote=<id>): skip the picker and add straight to it */
  preselectedQuoteId?: number;
  /** show each row's category name (filtering across categories) */
  showCategory: boolean;
}) {
  const firstSelectable = models.find((m) => m.orderable && m.price !== null)?.id ?? null;
  // Deep link (e.g. an order line, or a related-part "open" jump) preselects a row via ?sel=<modelId>.
  const sel = useSearchParams().get("sel");
  // undefined → use default (first); null → explicitly closed; string → user pick.
  const [picked, setPicked] = useState<string | null | undefined>(sel ?? undefined);
  const selectedId =
    picked === null ? null : picked && models.some((m) => m.id === picked) ? picked : firstSelectable;
  const selected = selectedId ? models.find((m) => m.id === selectedId) ?? null : null;

  // Follow the ?sel param: fires on mount and whenever a related-part jump pushes a new sel (a
  // soft nav doesn't remount, so `picked` is synced here), then scrolls the row into view.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!sel) return;
    setPicked(sel);
    listRef.current?.querySelector(`[data-model-id="${sel}"]`)?.scrollIntoView({ block: "center" });
  }, [sel]);

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
                    {m.compat.length > 0 && <CompatBadge modelName={m.name} compat={m.compat} />}
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
        <div className="relative flex flex-[1.4] min-w-0 flex-col border-l border-line">
          <VariationPanel
            exclusionGroups={exclusionGroups}
            key={selected.id}
            model={selected}
            variations={variations}
            variationStock={variationStock}
            itemModelMap={itemModelMap}
            itemModelAll={itemModelAll}
            itemModelCat={itemModelCat}
            itemCompat={itemCompat}
            notesMap={notesMap}
            isAdmin={isAdmin}
            canAirFreight={canAirFreight}
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
  variationStock,
  itemModelMap,
  itemModelAll,
  itemModelCat,
  itemCompat,
  notesMap,
  isAdmin,
  canAirFreight,
  quotes,
  preselectedQuoteId,
  onClose,
}: {
  model: BrowserModel;
  variations: VariationType[];
  exclusionGroups: Record<string, string[][]>;
  variationStock: Record<string, number | null>;
  itemModelMap: Record<string, string>;
  itemModelAll: Record<string, string>;
  itemModelCat: Record<string, string>;
  itemCompat: Record<string, BrowserModel["compat"]>;
  notesMap: Record<string, AccessoryModelNote>;
  isAdmin: boolean;
  canAirFreight: boolean;
  quotes: QuoteOpt[];
  preselectedQuoteId?: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const minQty = Math.max(1, model.moq);
  const tracked = model.stock !== null;
  const outOfStock = tracked && model.stock === 0;
  const maxQty = tracked ? (model.stock as number) : Infinity;

  const [motorQty, setMotorQty] = useState(minQty);
  // Air-freight add session: the add sheet is placing a from-China line for this out-of-stock model
  // (admin acting on a retailer's behalf). Skips the stock cap; server re-checks eligibility.
  const [air, setAir] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Inline "Create new quote" form inside the picker: name is optional.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  // Preselected quote starts expanded so its items are visible right away; the chevron still toggles.
  const [expandedQuote, setExpandedQuote] = useState<number | null>(preselectedQuoteId ?? null);
  // Which quote the add sheet is targeting (single-select). Null = fall back to the first (newest).
  const [target, setTarget] = useState<number | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  // "Buy on its own": when set, the quote picker adds THIS single part (its own catalog model) as a
  // standalone line instead of the configured motor + kit. null = normal motor mode.
  const [alone, setAlone] = useState<
    { name: string; modelId: string; stock: number | null; price: number | null; image: string | null } | null
  >(null);
  const [aloneQty, setAloneQty] = useState(1);

  const avail = useMemo(() => availableTypes(variations, model.availableItemIds), [variations, model.availableItemIds]);

  // Add-on part stock: undefined/null = untracked (unlimited).
  const stockOf = (id: string): number | null => {
    const s = variationStock[id];
    return s === undefined ? null : s;
  };

  // Nothing is bundled — every product (this one and the related "Works with" parts) is sold
  // separately, so this product's line is just its base price × quantity.
  const base = model.price ?? 0;

  const labelOf = (q: QuoteOpt) => q.quoteName || q.ref;
  const refOf = (id: number) => {
    const q = quotes.find((x) => x.id === id);
    return q ? labelOf(q) : "quote";
  };

  // Open the add sheet for THIS product (not a part); close + reset it.
  const openMainAdd = () => {
    setError(null);
    setAlone(null);
    setAir(false);
    setMotorQty(minQty);
    setCreating(false);
    setNewName("");
    setMenuOpen(true);
  };
  // Open the add sheet in air-freight mode: order this out-of-stock model from China (admin only).
  const openAirAdd = () => {
    setError(null);
    setAlone(null);
    setAir(true);
    setMotorQty(minQty);
    setCreating(false);
    setNewName("");
    setMenuOpen(true);
  };
  const closeSheet = () => {
    setMenuOpen(false);
    setCreating(false);
    setNewName("");
    setAlone(null);
    setAir(false);
  };

  // Add to an existing quote — stay on the page so the user can keep shopping. `aloneOverride`
  // lets a row add its part straight to a preselected quote without waiting on `alone` state.
  const doAdd = async (
    targetId: number,
    aloneOverride?: { name: string; modelId: string; stock: number | null }
  ) => {
    const a = aloneOverride ?? alone;
    const q = aloneOverride ? 1 : aloneQty;
    if (a && a.stock !== null && q > a.stock) return;
    setMenuOpen(false);
    setBusy(true);
    setError(null);
    try {
      // Standalone part → its own catalog model. Motor → just the motor (parts are never bundled).
      // Air-freight applies only to this out-of-stock model's own line (never a standalone part).
      const body = a
        ? { productId: a.modelId, qty: q, quoteId: targetId }
        : { productId: model.id, qty: motorQty, quoteId: targetId, ...(air ? { airFreight: true } : {}) };
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
  // Opens the SAME add sheet as a normal add — with a qty stepper — so quantity is editable, and
  // carries the part's image/price/stock so the sheet's header card can show them.
  const openAddAlone = (a: { name: string; modelId: string; stock: number | null; price: number | null; image: string | null }) => {
    setError(null);
    setCreating(false);
    setNewName("");
    setAlone(a);
    setAloneQty(1);
    setMenuOpen(true);
  };

  // A related part is a peer retail product — clicking it opens ITS own detail. Deep-link to the
  // part's source model (?cat=<catId>&sel=<modelId>) so the panel switches to it even across
  // categories; carry the active brand + preselected quote so context isn't lost.
  const openPart = (itemId: string) => {
    const modelId = itemModelMap[itemId];
    const catId = itemModelCat[itemId];
    if (!modelId || !catId) return;
    const p = new URLSearchParams();
    p.set("cat", catId);
    p.set("sel", modelId);
    const brand = searchParams.get("brand");
    if (brand) p.set("brand", brand);
    if (preselectedQuoteId != null) p.set("quote", String(preselectedQuoteId));
    router.push(`/catalog/accessories?${p.toString()}`);
  };

  // A related part's own "Add to quote": open the add sheet (qty stepper, + quote picker when
  // the target isn't already known) — the same flow as adding this product.
  const addPart = (it: VariationType["items"][number]) => {
    const modelId = itemModelMap[it.id];
    if (!modelId) return;
    openAddAlone({
      name: it.name,
      modelId,
      stock: stockOf(it.id),
      price: it.price ?? null,
      image: it.image ?? null,
    });
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
      // Keep the picker open so the freshly-created quote appears at the top of the list, and
      // select it so the confirm button targets it right away.
      setCreating(false);
      setNewName("");
      if (crData.quote?.id != null) setTarget(crData.quote.id);
      toast(`Created ${name || crData.quote.ref}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  // What the add-popover is adding — this product or a related part. Quantity is chosen at add
  // time (Taobao-style "add to cart"), so both share one qty block driven by these.
  const adding = alone
    ? { name: alone.name, qty: aloneQty, setQty: setAloneQty, min: 1, max: alone.stock ?? 999, price: alone.price, image: alone.image, stock: alone.stock }
    : {
        name: model.name,
        qty: motorQty,
        setQty: setMotorQty,
        min: minQty,
        // Air-freight isn't bounded by US stock (it's a from-China order); otherwise cap at stock.
        max: air ? Infinity : maxQty,
        price: model.price,
        image: model.image,
        // Suppress the "Out of stock" chip in the sheet header for an air-freight add.
        stock: air ? null : model.stock,
      };

  // The quote the sheet's single confirm button commits to: the user's pick if still valid,
  // otherwise the first (newest) quote. Null only when the retailer has no drafts yet.
  const effectiveTarget = target != null && quotes.some((q) => q.id === target) ? target : quotes[0]?.id ?? null;

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
        {/* Right column: close, then this product's primary "Add" — the focal product's buy action.
            Related parts each carry their own smaller Add; both open the same add sheet. */}
        <div className="flex shrink-0 flex-col items-end gap-3">
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            ✕
          </button>
          {/* Fitment note is a per-PART affordance only (see OptionRow); the focal product itself
              carries just its Add action. */}
          {!outOfStock ? (
            <Button variant="primary" onClick={openMainAdd} className="px-3.5 py-1.5 text-xs">
              ＋ Add
            </Button>
          ) : canAirFreight ? (
            // Out of stock in the US, but an admin acting for a retailer can order it from China.
            <Button variant="primary" onClick={openAirAdd} className="px-3.5 py-1.5 text-xs">
              ✈ Air freight
            </Button>
          ) : null}
        </div>
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

          {/* Works with — related retail products. Each is a peer: open its own detail, or add it
              to a quote on its own. Nothing is bundled with this product. */}
          {avail.length > 0 && (
            <div className="mt-5 space-y-4">
              <div className="border-t border-line/70 pt-4">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Works with</span>
                <p className="mt-1 text-[10.5px] leading-snug text-muted">
                  Parts sold separately. Open a part for its own details, or <span className="font-medium text-ink-soft">Add</span> it to a quote.
                </p>
              </div>

              {avail.map((t) => (
                <div key={t.id}>
                  <div className="mb-0.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                  </div>
                  <div>
                    {t.items.map((it) => (
                      <OptionRow
                        key={it.id}
                        item={it}
                        stock={stockOf(it.id)}
                        canOrder={!!itemModelMap[it.id]}
                        compat={itemCompat[it.id] ?? []}
                        noteModelId={itemModelAll[it.id]}
                        note={itemModelAll[it.id] ? notesMap[itemModelAll[it.id]] : undefined}
                        isAdmin={isAdmin}
                        onOpen={() => openPart(it.id)}
                        onAdd={() => addPart(it)}
                        onZoom={setZoom}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add sheet — slides up from the panel bottom, opened by the product's own Add (header) or
          any related part's Add. Standard "add to cart" flow: choose a quantity, then the target
          quote (or, when we arrived from one, confirm straight into it). There is no separate
          footer button — every item carries its own Add, so this sheet is the shared add surface. */}
      {menuOpen && (!outOfStock || air) && (
        <>
          <div className="absolute inset-0 z-30 bg-black/10" onClick={closeSheet} aria-hidden />
          <div className="absolute inset-x-0 bottom-0 z-40 flex max-h-[88%] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.3)]">
            {air && (
              <div className="flex items-center gap-1.5 border-b border-line/70 bg-brass-soft/50 px-4 py-2 text-[11px] font-medium text-[#8a6a39]">
                ✈ Air freight
              </div>
            )}
            {/* What you're adding — image, price, stock — plus the quantity stepper. Same card for
                this product and a related part, so both always show their photo/price/stock. */}
            <div className="flex items-center gap-3 border-b border-line/70 p-4">
              {adding.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={adding.image} alt={adding.name} className="size-12 shrink-0 rounded-lg bg-[#0e0e10] object-contain p-1" />
              ) : (
                <div className="size-12 shrink-0 rounded-lg bg-[#f1efe9]" />
              )}
              <div className="min-w-0 flex-1">
                {alone && <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brass">Part</div>}
                <div className="truncate text-[13.5px] font-semibold text-ink">{adding.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                  <span className="font-medium tabular-nums text-ink-soft">
                    {adding.price === null ? "Incl." : `${usd(adding.price)} / unit`}
                  </span>
                  {adding.stock !== null && (
                    <span className={cx(adding.stock <= 0 ? "font-medium text-red-500" : adding.stock <= 5 ? "text-amber-600" : "")}>
                      {adding.stock <= 0 ? "Out of stock" : `${adding.stock} in stock`}
                    </span>
                  )}
                </div>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <Stepper value={adding.qty} min={adding.min} max={adding.max} onChange={adding.setQty} />
              </div>
            </div>

            {error && <p className="px-4 pt-2 text-[11px] text-red-500">{error}</p>}

            {preselectedQuoteId != null ? (
              // Target quote is already known — one confirm, straight into it.
              <div className="p-4">
                <Button
                  variant="primary"
                  busy={busy}
                  onClick={() => doAdd(preselectedQuoteId)}
                  className="w-full justify-center py-2.5"
                >
                  {`Add ${adding.qty} to ${refOf(preselectedQuoteId)}`}
                </Button>
              </div>
            ) : (
              // Single-select target list + one confirm button (the "save to which list?" pattern):
              // tapping a row selects it (radio), the chevron previews its contents, and the sticky
              // footer button commits the add to whichever quote is selected.
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-auto p-1">
                  <div className="flex items-center justify-between gap-2 px-2 pt-1">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {quotes.length > 0 ? "Add to which quote?" : "Your quotes"}
                    </span>
                    {!creating && (
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
                  {quotes.length === 0 && !creating && (
                    <p className="px-2.5 py-2 text-[12px] leading-snug text-muted">
                      You don&rsquo;t have any draft quotes yet. Create one to add this to.
                    </p>
                  )}
                  {quotes.map((qu) => {
                    const open = expandedQuote === qu.id;
                    const expandable = qu.items.length > 0;
                    const selected = effectiveTarget === qu.id;
                    return (
                      <div key={qu.id}>
                        <div
                          className={cx(
                            "flex items-center gap-1 rounded-lg transition-colors",
                            selected ? "bg-[#f4f2ec]" : "hover:bg-[#faf9f5]"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => setTarget(qu.id)}
                            aria-pressed={selected}
                            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left"
                          >
                            <span
                              className={cx(
                                "grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors",
                                selected ? "border-ink bg-ink text-white" : "border-line"
                              )}
                            >
                              {selected && (
                                <svg viewBox="0 0 16 16" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <path d="M3 8.5l3.5 3.5L13 4.5" />
                                </svg>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-ink">{labelOf(qu)}</span>
                              <span className="block truncate text-[11px] text-muted">
                                {qu.quoteName ? `${qu.ref} · ` : ""}
                                {qu.itemCount} item{qu.itemCount === 1 ? "" : "s"}
                              </span>
                            </span>
                          </button>
                          {expandable && (
                            <button
                              type="button"
                              onClick={() => setExpandedQuote(open ? null : qu.id)}
                              aria-label={open ? "Hide items" : "Show items"}
                              aria-expanded={open}
                              className="mr-1 shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-[#efece3] hover:text-ink"
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

                {effectiveTarget != null && (
                  <div className="border-t border-line/70 p-3">
                    <Button
                      variant="primary"
                      busy={busy}
                      onClick={() => doAdd(effectiveTarget)}
                      className="w-full justify-center py-2.5"
                    >
                      {`Add ${adding.qty} to ${refOf(effectiveTarget)}`}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
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

/** One related retail product ("Works with"): a clickable row (thumbnail · name · price · stock)
 *  that opens the part's own detail, plus its own "Add" button. Nothing is bundled — each part is
 *  an independent product. Reference-only parts (no catalog model) render inert. */
function OptionRow({
  item,
  stock,
  canOrder,
  compat,
  noteModelId,
  note,
  isAdmin,
  onOpen,
  onAdd,
  onZoom,
}: {
  item: VariationType["items"][number];
  /** available stock; null = untracked */
  stock: number | null;
  /** the part is backed by its own orderable catalog model → it can be opened + added */
  canOrder: boolean;
  /** compatible-variation entries of the part's source catalog model (empty if none) */
  compat: BrowserModel["compat"];
  /** the part's source catalog model id (any part, orderable or not) — keys the fitment note */
  noteModelId?: string;
  /** the part's fitment note (free text + images); absent = none */
  note?: AccessoryModelNote;
  /** viewer is an admin → the fitment note is editable */
  isAdmin: boolean;
  /** open this part's own detail (deep-link to its model) */
  onOpen: () => void;
  /** add this part to a quote on its own */
  onAdd: () => void;
  onZoom: (url: string) => void;
}) {
  const outOfStock = stock !== null && stock <= 0;
  return (
    <div
      title={outOfStock ? "Out of stock" : canOrder ? "Open this part" : undefined}
      onClick={() => canOrder && !outOfStock && onOpen()}
      className={cx(
        "group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
        outOfStock ? "opacity-40" : canOrder ? "cursor-pointer hover:bg-[#faf9f5]" : ""
      )}
    >
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
        <div className="flex items-center gap-1 text-[12.5px] font-medium leading-snug text-ink">
          <span className="min-w-0 truncate">{item.name}</span>
          {canOrder && (
            <svg viewBox="0 0 16 16" className="size-3 shrink-0 text-muted transition-colors group-hover:text-ink" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 4l4 4-4 4" />
            </svg>
          )}
        </div>
        {compat.length > 0 && <CompatBadge modelName={item.name} compat={compat} />}
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          {item.price ? <span>{usd(item.price)} ea</span> : null}
          {outOfStock ? (
            <span className="font-medium text-red-500">Out of stock</span>
          ) : stock !== null ? (
            <span className={cx(stock <= 5 ? "text-amber-600" : "")}>{stock} in stock</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* Fitment note to the LEFT of Add: admins can always edit it; retailers see it only when
            a note exists. Only for parts backed by a catalog model. */}
        {noteModelId && (
          <AccessoryNoteButton modelId={noteModelId} modelName={item.name} note={note} isAdmin={isAdmin} />
        )}
        {/* Add this part to a quote on its own. Hidden when the part has no orderable model or is
            out of stock. Stops propagation so it doesn't also trigger the row's open-detail. */}
        {canOrder && !outOfStock && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAdd(); }}
            title="Add this part to a quote"
            className="rounded-md border border-line px-2.5 py-1 text-[10.5px] font-medium text-muted transition-colors hover:border-ink hover:text-ink group-hover:text-ink-soft"
          >
            ＋ Add
          </button>
        )}
      </div>
    </div>
  );
}
