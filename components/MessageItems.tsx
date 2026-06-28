"use client";

import type { MessageItemRef } from "@/lib/db";
import { cx } from "./ui";

/** Small thumbnail (product photo) or a package placeholder when there's no image. */
function Thumb({ src, alt }: { src?: string | null; alt: string }) {
  if (src) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={src} alt={alt} className="size-9 shrink-0 rounded-md bg-[#0e0e10] object-contain p-0.5" />
    );
  }
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-[#f4f2ec] text-sm" aria-hidden>
      📦
    </div>
  );
}

/**
 * The line items a customer attached to a support message. Rendered both inside a chat bubble
 * (read-only) and in the composer as removable chips before sending.
 */
export function MessageItemCards({
  items,
  onRemove,
  className,
}: {
  items: MessageItemRef[];
  onRemove?: (index: number) => void;
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <div className={cx("w-[280px] max-w-full overflow-hidden rounded-xl border border-line bg-[#faf9f5]", className)}>
      <div className="flex items-center gap-1 px-3 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">
        <span aria-hidden>📦</span> {items.length === 1 ? "Item in question" : `${items.length} items in question`}
      </div>
      <ul className="divide-y divide-line/60 px-3 pb-1.5">
        {items.map((it, i) => (
          <li key={i} className={cx("flex items-start gap-2.5 py-2", it.sub && "pl-3")}>
            <Thumb src={it.image} alt={it.name} />
            <div className="min-w-0 flex-1">
              <div className={cx("break-words font-medium leading-snug text-ink", it.sub ? "text-[11.5px]" : "text-[12.5px]")}>
                {it.name}
              </div>
              <div className="mt-0.5 break-words text-[10.5px] leading-snug text-muted">
                {[it.sku, it.summary].filter(Boolean).join(" · ") || `Qty ${it.qty}`}
              </div>
            </div>
            <span className="mt-0.5 shrink-0 text-[10.5px] font-medium tabular-nums text-muted">×{it.qty}</span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Remove ${it.name}`}
                className="shrink-0 rounded-md p-1 text-muted transition-colors hover:bg-[#efece4] hover:text-ink"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
