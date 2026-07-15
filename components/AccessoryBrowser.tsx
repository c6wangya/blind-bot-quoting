"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MessageItemRef, VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { availableTypes } from "@/lib/variation-logic";
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
  itemCompat,
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
  /** add-on part item id → its source model's compatible-variation entries (present only if any) */
  itemCompat: Record<string, BrowserModel["compat"]>;
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
        <div className="flex flex-[1.4] min-w-0 flex-col border-l border-line">
          <VariationPanel
            exclusionGroups={exclusionGroups}
            key={selected.id}
            model={selected}
            variations={variations}
            variationStock={variationStock}
            itemModelMap={itemModelMap}
            itemCompat={itemCompat}
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
  itemCompat,
  quotes,
  preselectedQuoteId,
  onClose,
}: {
  model: BrowserModel;
  variations: VariationType[];
  exclusionGroups: Record<string, string[][]>;
  variationStock: Record<string, number | null>;
  itemModelMap: Record<string, string>;
  itemCompat: Record<string, BrowserModel["compat"]>;
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
  // Read-only preview of the preselected quote's current items, toggled by the add-button chevron.
  const [preview, setPreview] = useState(false);
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

  // Add-on part stock: undefined/null = untracked (unlimited).
  const stockOf = (id: string): number | null => {
    const s = variationStock[id];
    return s === undefined ? null : s;
  };

  // Parts are never bundled with the motor — each is ordered on its own ("Add alone"). The motor
  // line is therefore just its base price × quantity.
  const base = model.price ?? 0;
  const unitPrice = base;
  const lineTotal = base * motorQty;

  const labelOf = (q: QuoteOpt) => q.quoteName || q.ref;
  const refOf = (id: number) => {
    const q = quotes.find((x) => x.id === id);
    return q ? labelOf(q) : "quote";
  };
  const preselectedQuote = preselectedQuoteId != null ? quotes.find((q) => q.id === preselectedQuoteId) ?? null : null;

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
      const body = a
        ? { productId: a.modelId, qty: q, quoteId: targetId }
        : { productId: model.id, qty: motorQty, quoteId: targetId };
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

          {/* Compatible parts — borderless rows, each ordered on its own via "Add alone" */}
          {avail.length > 0 && (
            <div className="mt-5 space-y-4">
              <div className="border-t border-line/70 pt-4">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Compatible parts</span>
                <p className="mt-1 text-[10.5px] leading-snug text-muted">
                  Each part is ordered on its own — <span className="font-medium text-ink-soft">Add alone</span> adds just that part to a quote.
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
                        canAlone={!!itemModelMap[it.id]}
                        compat={itemCompat[it.id] ?? []}
                        onAddAlone={() => openAddAlone(it.name, itemModelMap[it.id], stockOf(it.id))}
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
              <div className="text-[11px] text-muted">{motorQty} × {usd(unitPrice)}</div>
              <div className="text-[17px] font-semibold tabular-nums text-ink">{usd(lineTotal)}</div>
            </div>
          </div>

          {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}

          <div className="relative mt-3">
            {preselectedQuoteId != null ? (
              // Arrived from a specific quote: the button adds straight to it; the chevron reveals a
              // read-only preview of what's already in that quote (no second "add" step).
              <div className="flex items-stretch gap-1.5">
                <Button
                  variant="primary"
                  onClick={() => {
                    setAlone(null);
                    doAdd(preselectedQuoteId);
                  }}
                  busy={busy}
                  className="flex-1 justify-center py-2.5"
                >
                  {`Add to ${refOf(preselectedQuoteId)}`}
                </Button>
                {preselectedQuote && preselectedQuote.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPreview((o) => !o)}
                    aria-label={preview ? "Hide quote items" : "Show quote items"}
                    aria-expanded={preview}
                    className="flex shrink-0 items-center justify-center rounded-lg border border-line px-2.5 text-ink-soft transition-colors hover:border-ink hover:text-ink"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      className={cx("size-3.5 transition-transform", preview && "rotate-180")}
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
            ) : (
              <Button
                variant="primary"
                onClick={() => {
                  // Reveal the quote picker (with each quote's current items) so a target can be
                  // chosen/created before adding. The motor is a lone-part-free add.
                  setAlone(null);
                  setCreating(false);
                  setNewName("");
                  setMenuOpen((o) => !o);
                }}
                busy={busy}
                className="w-full justify-center py-2.5"
              >
                Add to quote
              </Button>
            )}

            {preview && preselectedQuote && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setPreview(false)} aria-hidden />
                <div className="absolute bottom-full right-0 z-40 mb-2 max-h-80 w-full overflow-auto rounded-xl border border-line bg-surface p-3 shadow-xl">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">In this quote</span>
                    <span className="min-w-0 truncate text-[11px] text-muted">
                      {labelOf(preselectedQuote)} · {preselectedQuote.itemCount} item{preselectedQuote.itemCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {preselectedQuote.items.map((it, i) => (
                      <li key={i} className={cx("flex items-center gap-2 text-[11.5px] leading-snug", it.sub && "pl-3")}>
                        <span className="min-w-0 flex-1 truncate text-ink-soft">
                          {it.sub && <span className="text-muted">↳ </span>}
                          {it.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted">×{it.qty}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

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

/** One compatible part: a borderless row (thumbnail · name · price · stock) with an "Add alone"
 *  button. Parts are never bundled with the motor — each is ordered on its own. */
function OptionRow({
  item,
  stock,
  canAlone,
  compat,
  onAddAlone,
  onZoom,
}: {
  item: VariationType["items"][number];
  /** available stock; null = untracked */
  stock: number | null;
  /** the part is backed by its own catalog model → it can be bought on its own */
  canAlone: boolean;
  /** compatible-variation entries of the part's source catalog model (empty if none) */
  compat: BrowserModel["compat"];
  onAddAlone: () => void;
  onZoom: (url: string) => void;
}) {
  const outOfStock = stock !== null && stock <= 0;
  return (
    <div
      title={outOfStock ? "Out of stock" : undefined}
      className={cx(
        "group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
        outOfStock ? "opacity-40" : "hover:bg-[#faf9f5]"
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
        <div className="text-[12.5px] font-medium leading-snug text-ink">{item.name}</div>
        {compat.length > 0 && <CompatBadge modelName={item.name} compat={compat} />}
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          {item.price ? <span>+{usd(item.price)} ea</span> : null}
          {outOfStock ? (
            <span className="font-medium text-red-500">Out of stock</span>
          ) : stock !== null ? (
            <span className={cx(stock <= 5 ? "text-amber-600" : "")}>{stock} in stock</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Buy on its own — the only way to order a part. Hidden only when the part has no catalog
            model to sell or is out of stock. */}
        {canAlone && !outOfStock && (
          <button
            type="button"
            onClick={onAddAlone}
            title="Add just this part to a quote — on its own"
            className="rounded-md border border-line px-2 py-1 text-[10.5px] font-medium text-muted transition-colors hover:border-ink hover:text-ink group-hover:text-ink-soft"
          >
            ＋ Add alone
          </button>
        )}
      </div>
    </div>
  );
}
