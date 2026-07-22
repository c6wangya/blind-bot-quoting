"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usd } from "@/lib/format";
import { Button, cx } from "./ui";

/** A standalone accessory compatible with a motor (its own orderable catalog model). */
export type PickerAccessory = {
  productId: string;
  name: string;
  sku: string;
  image: string | null;
  price: number | null;
  stock: number | null;
  moq: number;
};

/** A catalog motor (main product) offered as a replacement, plus its compatible accessories. */
export type PickerModel = {
  id: string;
  name: string;
  sku: string;
  image: string | null;
  price: number | null;
  stock: number | null;
  moq: number;
  categoryName: string;
  accessories: PickerAccessory[];
};

/** A replacement the admin has queued in the refund dialog (client estimate of value; server re-prices). */
export type ReplacementDraft = {
  productId: string;
  qty: number;
  variationItemIds: string[];
  name: string;
  /** Client-side value estimate (base price × qty) — the server computes the authoritative P. */
  value: number;
};

/**
 * Exchange-replacement picker, portaled above the refund dialog: search the orderable motor
 * catalog, pick one, then either add the motor itself or one of its compatible accessories (a
 * second tab). Products are sold standalone — the motor and each accessory are separate lines.
 */
export function ReplacementPicker({
  models,
  onAdd,
  onClose,
}: {
  models: PickerModel[];
  onAdd: (draft: ReplacementDraft) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => `${m.name} ${m.sku}`.toLowerCase().includes(q));
  }, [models, query]);

  const model = selectedId ? models.find((m) => m.id === selectedId) ?? null : null;

  const add = (draft: ReplacementDraft) => {
    onAdd(draft);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-6 text-left">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal className="relative my-auto flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-surface p-6 shadow-2xl">
        {!model ? (
          <>
            <h2 className="text-base font-semibold tracking-tight text-ink">Choose a replacement</h2>
            <p className="mt-1 text-[12.5px] text-muted">Ship a different product in place of the returned goods.</p>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or model №…"
              className="mt-3 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
            <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {filtered.length === 0 && <p className="py-6 text-center text-[13px] text-muted">No products match.</p>}
              {filtered.map((m) => {
                const out = m.stock === 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedId(m.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:border-ink"
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
                      <div className="truncate text-[11px] text-muted">
                        {m.categoryName}
                        {m.accessories.length > 0 && ` · ${m.accessories.length} accessories`}
                      </div>
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
          <ReplacementDetail model={model} onBack={() => setSelectedId(null)} onConfirm={add} />
        )}
      </div>
    </div>,
    document.body
  );
}

/** Detail step: tab 1 = the motor itself (qty + add); tab 2 = its compatible accessories (add each). */
function ReplacementDetail({
  model,
  onBack,
  onConfirm,
}: {
  model: PickerModel;
  onBack: () => void;
  onConfirm: (draft: ReplacementDraft) => void;
}) {
  const [tab, setTab] = useState<"product" | "accessories">("product");

  return (
    <>
      <button type="button" onClick={onBack} className="mb-2 self-start text-[12px] font-medium text-brass hover:underline">
        ← All products
      </button>
      <div className="flex items-start gap-3">
        {model.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={model.image} alt="" className="size-12 shrink-0 rounded-lg bg-[#0e0e10] object-contain p-1" />
        ) : (
          <div className="size-12 shrink-0 rounded-lg bg-[#f1efe9]" />
        )}
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-ink">
            {model.name} <span className="font-normal text-muted">{model.sku}</span>
          </h2>
          <p className="text-[11.5px] text-muted">{model.categoryName}</p>
        </div>
      </div>

      {/* Tabs: the product itself vs its compatible accessories (each added as a separate line). */}
      <div className="mt-4 flex gap-1 rounded-xl bg-[#f1efe9] p-1">
        {([
          { id: "product" as const, label: "This product" },
          { id: "accessories" as const, label: `Accessories (${model.accessories.length})` },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              "flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
              tab === t.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "product" ? (
        <ProductTab model={model} onConfirm={onConfirm} />
      ) : (
        <AccessoriesTab accessories={model.accessories} onConfirm={onConfirm} />
      )}
    </>
  );
}

/** The motor itself: quantity + value + add. Value = base price × qty. */
function ProductTab({ model, onConfirm }: { model: PickerModel; onConfirm: (draft: ReplacementDraft) => void }) {
  const minQty = Math.max(1, model.moq);
  const tracked = model.stock !== null;
  const max = tracked ? (model.stock as number) : Infinity;
  const [qty, setQty] = useState(minQty);
  const out = model.stock === 0;
  const lineValue = Math.round((model.price ?? 0) * qty * 100) / 100;

  return (
    <>
      <div className="mt-5 flex items-center justify-between">
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

      <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
        <span className="text-[13px] text-ink-soft">
          Replacement value <span className="font-semibold tabular-nums text-ink">{usd(lineValue)}</span>
        </span>
        <Button
          variant="primary"
          className="py-2"
          disabled={out}
          onClick={() => onConfirm({ productId: model.id, qty, variationItemIds: [], name: model.name, value: lineValue })}
        >
          {out ? "Out of stock" : "Add replacement"}
        </Button>
      </div>
    </>
  );
}

/** The motor's compatible accessories — each with its own qty stepper and Add button. */
function AccessoriesTab({
  accessories,
  onConfirm,
}: {
  accessories: PickerAccessory[];
  onConfirm: (draft: ReplacementDraft) => void;
}) {
  const [qtyById, setQtyById] = useState<Record<string, number>>({});
  const qtyOf = (a: PickerAccessory) => qtyById[a.productId] ?? Math.max(1, a.moq);
  const setQty = (a: PickerAccessory, next: number) => {
    const max = a.stock ?? Infinity;
    setQtyById((prev) => ({ ...prev, [a.productId]: Math.max(Math.max(1, a.moq), Math.min(max, next)) }));
  };

  if (accessories.length === 0) {
    return <p className="mt-6 py-6 text-center text-[13px] text-muted">No accessories are linked to this product.</p>;
  }

  return (
    <div className="mt-4 max-h-[46vh] space-y-1.5 overflow-y-auto">
      {accessories.map((a) => {
        const out = a.stock === 0;
        const q = qtyOf(a);
        const minQty = Math.max(1, a.moq);
        const max = a.stock ?? Infinity;
        return (
          <div key={a.productId} className={cx("flex items-center gap-3 rounded-xl border border-line px-3 py-2.5", out && "opacity-50")}>
            {a.image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={a.image} alt="" className="size-9 shrink-0 rounded-lg bg-[#0e0e10] object-contain p-1" />
            ) : (
              <div className="size-9 shrink-0 rounded-lg bg-[#f1efe9]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink">
                {a.name} <span className="font-normal text-muted">{a.sku}</span>
              </div>
              <div className="text-[11px] text-muted">
                {a.price != null ? usd(a.price) : "—"}
                {out && <span className="ml-1 font-medium text-red-500">· Out of stock</span>}
              </div>
            </div>
            {!out && (
              <>
                <div className="flex shrink-0 items-center rounded-lg border border-line">
                  <button onClick={() => setQty(a, q - 1)} disabled={q <= minQty} className="px-2 py-0.5 text-ink-soft hover:text-ink disabled:opacity-30">
                    −
                  </button>
                  <span className="w-7 text-center text-[13px] font-semibold tabular-nums">{q}</span>
                  <button onClick={() => setQty(a, q + 1)} disabled={q >= max} className="px-2 py-0.5 text-ink-soft hover:text-ink disabled:opacity-30">
                    +
                  </button>
                </div>
                <Button
                  variant="primary"
                  className="shrink-0 px-3 py-1.5 text-[12.5px]"
                  onClick={() =>
                    onConfirm({
                      productId: a.productId,
                      qty: q,
                      variationItemIds: [],
                      name: a.name,
                      value: Math.round((a.price ?? 0) * q * 100) / 100,
                    })
                  }
                >
                  Add
                </Button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
