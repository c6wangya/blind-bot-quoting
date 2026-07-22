"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { VariationType } from "@/lib/db";
import { usd } from "@/lib/format";
import { availableTypes, buildBlockedFromGroups, buildItemNames, disabledFor } from "@/lib/variation-logic";
import { VariationPicker } from "./AccessoryActions";
import { Button, cx } from "./ui";

/** A catalog accessory offered as an exchange replacement (a slim, serialisable slice of the model). */
export type PickerModel = {
  id: string;
  name: string;
  sku: string;
  image: string | null;
  price: number | null;
  stock: number | null;
  moq: number;
  categoryName: string;
  availableItemIds: string[];
  defaultItemIds: string[];
};

/** A replacement the admin has queued in the refund dialog (client estimate of value; server re-prices). */
export type ReplacementDraft = {
  productId: string;
  qty: number;
  variationItemIds: string[];
  name: string;
  /** Client-side value estimate (base + variations) × qty — the server computes the authoritative P. */
  value: number;
};

/**
 * Full exchange-replacement configurator, portaled above the refund dialog: search the orderable
 * accessory catalog, pick a model, choose its variations (exclusion groups grey out conflicts),
 * set a quantity, and queue it. Mirrors the catalog's AddAccessoryButton options flow.
 */
export function ReplacementPicker({
  models,
  variations,
  exclusionGroups,
  onAdd,
  onClose,
}: {
  models: PickerModel[];
  variations: VariationType[];
  exclusionGroups: Record<string, string[][]>;
  onAdd: (draft: ReplacementDraft) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const itemPrice = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of variations) for (const it of t.items) m[it.id] = it.price ?? 0;
    return m;
  }, [variations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => `${m.name} ${m.sku}`.toLowerCase().includes(q));
  }, [models, query]);

  const model = selectedId ? models.find((m) => m.id === selectedId) ?? null : null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-6 text-left">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal className="relative my-auto flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-surface p-6 shadow-2xl">
        {!model ? (
          <>
            <h2 className="text-base font-semibold tracking-tight text-ink">Choose a replacement</h2>
            <p className="mt-1 text-[12.5px] text-muted">Ship a different accessory in place of the returned goods.</p>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or model №…"
              className="mt-3 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
            <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {filtered.length === 0 && <p className="py-6 text-center text-[13px] text-muted">No accessories match.</p>}
              {filtered.map((m) => {
                const out = m.stock === 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={out}
                    onClick={() => setSelectedId(m.id)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      out ? "cursor-not-allowed border-line opacity-50" : "border-line hover:border-ink"
                    )}
                  >
                    {m.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={m.image} alt="" className="size-10 shrink-0 rounded-lg bg-[#0e0e10] object-contain p-1" />
                    ) : (
                      <div className="size-10 shrink-0 rounded-lg bg-[#f1efe9]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-ink">
                        {m.name} <span className="font-normal text-muted">{m.sku}</span>
                      </div>
                      <div className="truncate text-[11px] text-muted">{m.categoryName}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[13px] font-semibold tabular-nums text-ink">{m.price != null ? usd(m.price) : "—"}</div>
                      {out && <div className="text-[10.5px] font-medium text-red-500">Out of stock</div>}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={onClose} className="py-2">
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <ReplacementOptions
            model={model}
            variations={variations}
            exclusionGroups={exclusionGroups}
            itemPrice={itemPrice}
            onZoom={setZoom}
            onBack={() => setSelectedId(null)}
            onConfirm={(draft) => {
              onAdd(draft);
              onClose();
            }}
          />
        )}

        {zoom && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-8" onClick={() => setZoom(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom} alt="" className="max-h-full max-w-full rounded-xl bg-[#0e0e10] object-contain p-2" />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Options step: qty + variation multi-selects for the chosen model, then confirm. */
function ReplacementOptions({
  model,
  variations,
  exclusionGroups,
  itemPrice,
  onZoom,
  onBack,
  onConfirm,
}: {
  model: PickerModel;
  variations: VariationType[];
  exclusionGroups: Record<string, string[][]>;
  itemPrice: Record<string, number>;
  onZoom: (url: string) => void;
  onBack: () => void;
  onConfirm: (draft: ReplacementDraft) => void;
}) {
  const minQty = Math.max(1, model.moq);
  const tracked = model.stock !== null;
  const max = tracked ? (model.stock as number) : Infinity;
  const [qty, setQty] = useState(minQty);

  const avail = useMemo(() => availableTypes(variations, model.availableItemIds), [variations, model.availableItemIds]);
  const blocked = useMemo(() => buildBlockedFromGroups(exclusionGroups[model.id] ?? []), [exclusionGroups, model.id]);
  const itemName = useMemo(() => buildItemNames(avail), [avail]);

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
        if (model.defaultItemIds.includes(i.id) && compatible(i.id)) {
          ids.push(i.id);
          chosen.add(i.id);
        }
      p[t.id] = ids;
    }
    return p;
  });

  const selectedIds = avail.flatMap((t) => pick[t.id] ?? []);
  const selectedSet = new Set(selectedIds);
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

  const unitValue = (model.price ?? 0) + selectedIds.reduce((s, id) => s + (itemPrice[id] ?? 0), 0);
  const lineValue = Math.round(unitValue * qty * 100) / 100;

  return (
    <>
      <button type="button" onClick={onBack} className="mb-2 self-start text-[12px] font-medium text-brass hover:underline">
        ← All accessories
      </button>
      <h2 className="text-base font-semibold tracking-tight text-ink">
        {model.name} <span className="font-normal text-muted">{model.sku}</span>
      </h2>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Quantity</span>
        <div className="flex items-center rounded-lg border border-line">
          <button onClick={() => setQty((q) => Math.max(minQty, q - 1))} disabled={qty <= minQty} className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30">
            −
          </button>
          <span className="w-10 text-center text-sm font-semibold tabular-nums">{qty}</span>
          <button onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} className="px-2.5 py-1 text-ink-soft hover:text-ink disabled:opacity-30">
            +
          </button>
        </div>
      </div>
      {tracked && <p className="mt-1 text-right text-[10.5px] text-muted">{model.stock} in stock</p>}

      {avail.length > 0 && (
        <div className="mt-4 max-h-[40vh] space-y-4 overflow-y-auto">
          {avail.map((t) => {
            const d = disabledFor(t, selectedSet, blocked, itemName);
            return (
              <div key={t.id}>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                <VariationPicker type={t} values={pick[t.id] ?? []} onToggle={(v) => choose(t.id, v)} onZoom={onZoom} disabled={d.ids} disabledReason={d.reason} />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <span className="text-[13px] text-ink-soft">
          Replacement value <span className="font-semibold tabular-nums text-ink">{usd(lineValue)}</span>
        </span>
        <Button
          variant="primary"
          className="py-2"
          onClick={() =>
            onConfirm({ productId: model.id, qty, variationItemIds: selectedIds, name: model.name, value: lineValue })
          }
        >
          Add replacement
        </Button>
      </div>
    </>
  );
}
