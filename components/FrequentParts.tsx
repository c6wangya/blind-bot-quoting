"use client";

import { useSyncExternalStore } from "react";
import { AddAccessoryButton } from "./AccessoryActions";
import { Card, cx } from "./ui";
import type { VariationRestriction, VariationType } from "@/lib/db";
import { usd } from "@/lib/format";

// Open/closed is toggled from the toolbar button; default closed. The choice persists across
// navigation (localStorage) and re-renders both the button + card via a custom event.
const OPEN_KEY = "frequent-parts-open";
const EVENT = "frequent-parts-change";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
function setOpen(open: boolean) {
  localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  window.dispatchEvent(new Event(EVENT));
}
function useFrequentPartsOpen() {
  // SSR snapshot = false so the card never flashes in before hydration.
  return useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(OPEN_KEY) === "1",
    () => false,
  );
}

/** Toolbar toggle that shows/hides the "Frequently ordered" card. Always visible. */
export function FrequentPartsToggle() {
  const open = useFrequentPartsOpen();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      className={cx(
        "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors",
        open ? "border-ink text-ink" : "border-line text-ink-soft hover:border-ink"
      )}
    >
      <span className="text-[13px] leading-none">★</span>
      Frequently ordered
    </button>
  );
}

export type FrequentPart = {
  modelId: string;
  name: string;
  sku: string;
  image: string;
  price: number;
  orderCount: number;
  stock: number | null;
  availableItemIds: string[];
  defaultItemIds: string[];
  moq: number;
};

/**
 * "Frequently ordered" strip — a retailer's top parts (by how many past orders each appears in),
 * pinned above the catalog browser so a re-order is one tap. Renders nothing without history.
 */
export function FrequentParts({
  parts,
  quoteId,
  variations,
  restrictions,
}: {
  parts: FrequentPart[];
  quoteId?: number;
  variations: VariationType[];
  restrictions: VariationRestriction[];
}) {
  const open = useFrequentPartsOpen();

  if (!open) return null;
  return (
    <Card className="rise relative mb-5 px-4 py-4 sm:px-5">
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-muted transition-colors hover:text-ink"
      >
        ✕
      </button>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 pr-6">
        <span className="text-[13px] font-semibold text-ink">★ Frequently ordered</span>
        <span className="text-[11.5px] text-muted">Your most-ordered parts — add again in one tap</span>
      </div>
      {parts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-[#fbfaf6] px-4 py-6 text-center text-[12.5px] text-muted">
          No frequently ordered parts yet — your most-ordered parts will appear here once you have order history.
        </div>
      ) : (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {parts.map((p) => (
          <div key={p.modelId} className="flex gap-3 rounded-xl border border-line bg-[#fbfaf6] p-3">
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.image}
                alt={p.name}
                className="size-14 shrink-0 rounded-xl bg-[#0e0e10] object-contain p-1.5"
              />
            ) : (
              <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[#0e0e10] text-[10px] font-medium text-white/40">
                No image
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink" title={p.name}>
                {p.name}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                <span className="font-mono">{p.sku}</span>
                <span className="rounded bg-brass-soft px-1.5 py-0.5 font-medium text-[#8a6a39]">
                  ordered {p.orderCount}×
                </span>
              </div>
              <div className="mt-1 text-[14px] font-semibold tabular-nums text-ink">{usd(p.price)}</div>
              <div className="mt-2">
                <AddAccessoryButton
                  modelId={p.modelId}
                  quoteId={quoteId}
                  stock={p.stock}
                  variations={variations}
                  availableItemIds={p.availableItemIds}
                  defaultItemIds={p.defaultItemIds}
                  restrictions={restrictions}
                  minOrder={p.moq}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
    </Card>
  );
}
