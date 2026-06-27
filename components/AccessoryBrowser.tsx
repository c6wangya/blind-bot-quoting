"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { VariationRestriction, VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { stashPendingItem } from "@/lib/pending-item";
import { availableTypes, buildBlocked, buildItemNames, disabledFor } from "@/lib/variation-logic";
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
export type QuoteOpt = { id: number; ref: string; projectName: string | null; itemCount: number };

/** One unified, full-height panel: a summary list (left) glued to a detail + configure pane
 *  (right). The page constrains the height; both sides scroll internally. */
export function AccessoryBrowser({
  models,
  variations,
  restrictions,
  variationStock,
  quotes,
  showCategory,
}: {
  models: BrowserModel[];
  variations: VariationType[];
  restrictions: VariationRestriction[];
  /** add-on part item id → stock (null = untracked) */
  variationStock: Record<string, number | null>;
  /** the user's open draft quotes (for the in-page picker) */
  quotes: QuoteOpt[];
  /** show each row's category name (filtering across categories) */
  showCategory: boolean;
}) {
  const firstSelectable = models.find((m) => m.orderable && m.price !== null)?.id ?? null;
  // undefined → use default (first); null → explicitly closed; string → user pick.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const selectedId =
    picked === null ? null : picked && models.some((m) => m.id === picked) ? picked : firstSelectable;
  const selected = selectedId ? models.find((m) => m.id === selectedId) ?? null : null;

  return (
    <div className="flex h-full overflow-hidden rounded-2xl border border-line bg-surface">
      {/* Summary list */}
      <div className={cx("min-w-0 overflow-y-auto", selected ? "flex-1" : "flex-1")}>
        {models.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted">No models match these filters.</div>
        ) : (
          <ul className="divide-y divide-line/70">
            {models.map((m) => {
              const active = m.id === selectedId;
              const selectable = m.orderable && m.price !== null;
              return (
                <li
                  key={m.id}
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
            key={selected.id}
            model={selected}
            variations={variations}
            restrictions={restrictions}
            variationStock={variationStock}
            quotes={quotes}
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
  restrictions,
  variationStock,
  quotes,
  onClose,
}: {
  model: BrowserModel;
  variations: VariationType[];
  restrictions: VariationRestriction[];
  variationStock: Record<string, number | null>;
  quotes: QuoteOpt[];
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
  const [zoom, setZoom] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const avail = useMemo(() => availableTypes(variations, model.availableItemIds), [variations, model.availableItemIds]);
  const blocked = useMemo(() => buildBlocked(restrictions), [restrictions]);
  const itemName = useMemo(() => buildItemNames(avail), [avail]);
  const priceOf = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of avail) for (const i of t.items) m[i.id] = i.price;
    return m;
  }, [avail]);

  // Single-select per type (one item per CROWN / DRIVE …). "" = none. Initial state defaults to
  // one pick per type — the admin default if set, else the first in-stock, non-conflicting item.
  // Not mandatory: the user can Clear any of them.
  const [pick, setPick] = useState<Record<string, string>>(() => {
    const p: Record<string, string> = {};
    const chosen = new Set<string>(); // already-seeded ids, for the 互斥 (mutual-exclusion) check
    const inStock = (id: string) => {
      const s = variationStock[id];
      return s === undefined || s === null || s > 0;
    };
    const compatible = (id: string) => {
      const c = blocked.get(id);
      if (!c) return true;
      for (const x of chosen) if (c.has(x)) return false;
      return true;
    };
    for (const t of avail) {
      const def = t.items.find((i) => model.defaultItemIds.includes(i.id));
      const fallback = t.items.find((i) => inStock(i.id) && compatible(i.id));
      const id = def?.id ?? fallback?.id ?? "";
      p[t.id] = id;
      if (id) chosen.add(id);
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

  // Select (or clear, itemId="") within a type. No pairing; a now-incompatible pick in another
  // type drops out (互斥). Out-of-stock items can't be picked.
  const choose = (typeId: string, itemId: string) => {
    if (itemId && (stockOf(itemId) ?? Infinity) <= 0) return;
    setPick((prev) => {
      const next = { ...prev, [typeId]: itemId };
      const conflicts = itemId ? blocked.get(itemId) : undefined;
      if (conflicts) for (const other of avail) if (other.id !== typeId && next[other.id] && conflicts.has(next[other.id])) next[other.id] = "";
      return next;
    });
  };

  // Currently picked item ids (one per type).
  const selectedIds = avail.map((t) => pick[t.id]).filter(Boolean) as string[];

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

  const refOf = (id: number) => quotes.find((q) => q.id === id)?.ref ?? "quote";

  // Add to a specific quote (stay on the page so the user can keep shopping), or create a new one
  // (unchanged: stash + go to /quotes/new). targetId === null → create new.
  const doAdd = async (targetId: number | null) => {
    if (oversold.size > 0) return;
    setMenuOpen(false);
    const variationItems = selectedIds.map((id) => ({ itemId: id, qty: qtyOf(id) }));
    if (targetId === null) {
      stashPendingItem({ kind: "accessory", productId: model.id, qty: motorQty, variationItems });
      router.push("/quotes/new");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/quote-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: model.id, qty: motorQty, quoteId: targetId, variationItems }),
      });
      if (r.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not add to quote");
      setBusy(false);
      toast(`Added ${model.name} to ${refOf(targetId)}`);
      router.refresh(); // refresh the draft list (item counts) without leaving the page
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
              <div className="flex items-baseline justify-between border-t border-line/70 pt-4">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Add-on parts</span>
                <span className="text-[10.5px] text-muted">Qty is per motor</span>
              </div>

              {avail.map((t) => {
                const d = disabledFor(t, avail, (x) => pick[x.id] ?? "", blocked, itemName);
                const sel = pick[t.id] ?? "";
                return (
                  <div key={t.id}>
                    <div className="mb-0.5 flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                      {sel && (
                        <button onClick={() => choose(t.id, "")} className="text-[10.5px] font-medium text-muted hover:text-ink">
                          Clear
                        </button>
                      )}
                    </div>
                    <div>
                      {t.items.map((it) => (
                        <OptionRow
                          key={it.id}
                          item={it}
                          selected={sel === it.id}
                          disabled={d.ids.has(it.id) && sel !== it.id}
                          reason={d.reason[it.id]}
                          stock={stockOf(it.id)}
                          oversold={oversold.has(it.id)}
                          qty={qtyOf(it.id)}
                          onToggle={() => choose(t.id, sel === it.id ? "" : it.id)}
                          onQty={(n) => setQty(it.id, n)}
                          onZoom={setZoom}
                        />
                      ))}
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
              onClick={() => setMenuOpen((o) => !o)}
              busy={busy}
              disabled={oversold.size > 0}
              className="w-full justify-center py-2.5"
            >
              Add to quote
            </Button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden />
                <div className="absolute bottom-full right-0 z-40 mb-2 max-h-64 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
                  {quotes.length > 0 && (
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Add to existing</div>
                  )}
                  {quotes.map((qu) => (
                    <button
                      key={qu.id}
                      onClick={() => doAdd(qu.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[#faf9f5]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {qu.ref}
                          {qu.projectName ? ` · ${qu.projectName}` : ""}
                        </span>
                        <span className="block text-[11px] text-muted">{qu.itemCount} item{qu.itemCount === 1 ? "" : "s"}</span>
                      </span>
                    </button>
                  ))}
                  {quotes.length > 0 && <div className="my-1 border-t border-line/70" />}
                  <button
                    onClick={() => doAdd(null)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:bg-[#faf9f5]"
                  >
                    <span className="text-[15px] leading-none text-brass">＋</span> Create new quote
                  </button>
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
        "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
        blocked ? "cursor-not-allowed opacity-40" : selected ? "cursor-pointer bg-[#fbf8f1]" : "cursor-pointer hover:bg-[#faf9f5]"
      )}
    >
      <span className={cx("flex size-[18px] shrink-0 items-center justify-center rounded-full border", selected ? "border-ink" : "border-line")}>
        {selected && <span className="size-2.5 rounded-full bg-ink" />}
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
      {selected && (
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Stepper value={qty} min={1} max={stock !== null ? stock : 999} onChange={onQty} />
        </div>
      )}
    </div>
  );
}
