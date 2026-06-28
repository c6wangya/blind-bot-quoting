"use client";

import { useState } from "react";
import type { MessageItemRef } from "@/lib/db";
import { Button, cx } from "./ui";

/** Thumbnail or package placeholder (mirrors MessageItems). Sub-parts use a smaller box. */
function Thumb({ src, alt, sub = false }: { src?: string | null; alt: string; sub?: boolean }) {
  const box = sub ? "size-8" : "size-10";
  if (src) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={src} alt={alt} className={cx(box, "shrink-0 rounded-md bg-[#0e0e10] object-contain p-0.5")} />
    );
  }
  return (
    <div className={cx(box, "flex shrink-0 items-center justify-center rounded-md border border-line bg-[#f4f2ec] text-base")} aria-hidden>
      📦
    </div>
  );
}

/**
 * Overlay sheet listing a quote/order's line items so the customer can tick the ones their message
 * is about. Fills its parent (ChatThread is position:relative). Returns the chosen snapshots on Add.
 */
export function MessageItemPicker({
  items,
  initialSelected,
  onConfirm,
  onCancel,
}: {
  items: MessageItemRef[];
  initialSelected: MessageItemRef[];
  onConfirm: (selected: MessageItemRef[]) => void;
  onCancel: () => void;
}) {
  // Identity by list index — `items` is stable for a given thread render.
  const initialIdx = new Set(
    initialSelected
      .map((s) => items.findIndex((it) => it.name === s.name && it.sku === s.sku && it.summary === s.summary))
      .filter((i) => i >= 0)
  );
  const [picked, setPicked] = useState<Set<number>>(initialIdx);

  const toggle = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  // Group each main item with the sub-parts that follow it, so a motor + its Crown/Drive read as
  // one nested card instead of three separate boxes.
  const groups: { main: number; subs: number[] }[] = [];
  items.forEach((it, i) => {
    if (it.sub && groups.length) groups[groups.length - 1].subs.push(i);
    else groups.push({ main: i, subs: [] });
  });

  // One selectable row (checkbox + thumbnail + wrapping name + qty). Sub-parts are tighter + smaller.
  const Row = ({ index, sub }: { index: number; sub: boolean }) => {
    const it = items[index];
    const on = picked.has(index);
    return (
      <button
        type="button"
        onClick={() => toggle(index)}
        className={cx(
          "flex w-full items-start gap-2.5 px-3 text-left transition-colors",
          sub ? "py-2" : "py-2.5",
          on ? "bg-[#f4f2ec]" : "hover:bg-[#faf9f5]"
        )}
      >
        <span
          className={cx(
            "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border text-[10px] font-bold text-white transition-colors",
            on ? "border-ink bg-ink" : "border-line bg-surface"
          )}
          aria-hidden
        >
          {on ? "✓" : ""}
        </span>
        <Thumb src={it.image} alt={it.name} sub={sub} />
        <span className="min-w-0 flex-1">
          <span className={cx("block break-words font-medium leading-snug text-ink", sub ? "text-[11.5px]" : "text-[12.5px]")}>
            {it.name}
          </span>
          <span className="mt-0.5 block break-words text-[10.5px] leading-snug text-muted">
            {[it.sku, it.summary].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 text-[10.5px] font-medium tabular-nums text-muted">×{it.qty}</span>
      </button>
    );
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-ink">Reference items</div>
          <div className="text-[11px] text-muted">Tick the products or accessories your message is about</div>
        </div>
        <button
          onClick={onCancel}
          aria-label="Close"
          className="-mr-1 rounded-lg p-1 text-muted hover:bg-[#f4f2ec] hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2.5">
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">No items on this order.</p>
        ) : (
          <ul className="space-y-2.5">
            {groups.map((g, gi) => (
              <li key={gi} className="overflow-hidden rounded-xl border border-line">
                <Row index={g.main} sub={false} />
                {g.subs.length > 0 && (
                  <div className="border-t border-line/70 bg-[#fafaf7] pl-4">
                    {g.subs.map((si) => (
                      <Row key={si} index={si} sub />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
        <Button variant="secondary" onClick={onCancel} className="flex-1 py-2">
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => onConfirm(items.filter((_, i) => picked.has(i)))}
          className="flex-1 py-2"
        >
          {picked.size > 0 ? `Add ${picked.size}` : "Done"}
        </Button>
      </div>
    </div>
  );
}
