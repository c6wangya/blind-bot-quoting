"use client";

import { useSyncExternalStore } from "react";
import { AddAccessoryButton } from "./AccessoryActions";
import { Card } from "./ui";
import type { VariationRestriction, VariationType } from "@/lib/db";
import { usd } from "@/lib/format";

// Dismissal persists across navigation (localStorage) and re-renders via a custom event.
const DISMISS_KEY = "frequent-parts-dismissed";
const EVENT = "frequent-parts-change";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
function dismissFrequentParts() {
  localStorage.setItem(DISMISS_KEY, "1");
  window.dispatchEvent(new Event(EVENT));
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
  // Hidden during SSR (server snapshot = true) so a previously-dismissed card never flashes in.
  const hidden = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(DISMISS_KEY) === "1",
    () => true,
  );

  if (parts.length === 0 || hidden) return null;
  return (
    <Card className="rise relative mb-5 px-4 py-4 sm:px-5">
      <button
        type="button"
        onClick={dismissFrequentParts}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-muted transition-colors hover:text-ink"
      >
        ✕
      </button>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-0.5 pr-6">
        <span className="text-[13px] font-semibold text-ink">★ Frequently ordered</span>
        <span className="text-[11.5px] text-muted">Your most-ordered parts — add again in one tap</span>
      </div>
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
    </Card>
  );
}
