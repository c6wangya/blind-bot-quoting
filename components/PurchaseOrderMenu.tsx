"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The order page's "Purchase order file" button — a dropdown offering the PO as PDF (the printable
 * per-brand page) or Excel (.xlsx). Both are per brand; a multi-brand order groups the choices by
 * brand and adds an "all brands" combined workbook.
 *
 * The panel is portaled to document.body and position:fixed, anchored to the button via
 * getBoundingClientRect. The order page's cards + a transformed layout ancestor form stacking
 * contexts (.rise keeps a lingering transform), so an in-tree menu — even fixed — gets painted
 * underneath. Portaling to body puts it in the root stacking context, above everything.
 */
export function PurchaseOrderMenu({ orderId, brands }: { orderId: number; brands: string[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, place]);

  const pdfHref = (brand: string) => `/purchase-orders/${orderId}?brand=${encodeURIComponent(brand)}`;
  const xlsxHref = (brand?: string) =>
    `/api/orders/${orderId}/excel${brand ? `?brand=${encodeURIComponent(brand)}` : ""}`;

  const multi = brands.length > 1;
  const itemCls =
    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink transition-colors hover:bg-[#faf9f5]";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#2a3756] hover:shadow"
      >
        ⬇ Purchase order file
        <span className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>

      {open &&
        createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-64 rounded-xl border border-line bg-white p-1.5 shadow-lg"
        >
          {!multi ? (
            <>
              <a href={pdfHref(brands[0])} target="_blank" rel="noopener noreferrer" className={itemCls}>
                📄 Download PDF
              </a>
              <a href={xlsxHref(brands[0])} className={itemCls}>
                ⬇ Download Excel (.xlsx)
              </a>
            </>
          ) : (
            <>
              {brands.map((b) => (
                <div key={b} className="px-2 pb-1 pt-1.5">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{b}</div>
                  <div className="flex gap-1.5">
                    <a
                      href={pdfHref(b)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded-lg border border-line px-2 py-1.5 text-center text-[12px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
                    >
                      📄 PDF
                    </a>
                    <a
                      href={xlsxHref(b)}
                      className="flex-1 rounded-lg border border-line px-2 py-1.5 text-center text-[12px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
                    >
                      ⬇ .xlsx
                    </a>
                  </div>
                </div>
              ))}
              <a href={xlsxHref()} className={`mt-1 border-t border-line ${itemCls}`}>
                ⬇ All brands (.xlsx)
              </a>
            </>
          )}
        </div>,
          document.body
        )}
    </>
  );
}
