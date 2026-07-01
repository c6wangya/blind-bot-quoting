"use client";

import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, Card, cx } from "./ui";

/** Compact catalog toolbar: brand › category breadcrumb (click to switch), inline search, and a
 *  collapsible Filters panel with an active-count badge + removable filter chips. */
export function AccessoryToolbar({
  brands,
  categories,
  activeLabel,
  chips,
  clearAllHref,
  filterCount,
  searchSlot,
  filtersSlot,
  frequentSlot,
}: {
  brands: { id: string; name: string; href: string; active: boolean }[];
  categories: { id: string; name: string; count: number; orderable: boolean; href: string; active: boolean }[];
  activeLabel: string;
  chips: { label: string; href: string }[];
  clearAllHref: string;
  filterCount: number;
  searchSlot: ReactNode;
  filtersSlot: ReactNode;
  frequentSlot?: ReactNode;
}) {
  const [brandOpen, setBrandOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  // Start expanded when a filter is already active (e.g. arriving via a ?compat= deep link) so
  // the applied facet is visible; otherwise stay collapsed.
  const [filtersOpen, setFiltersOpen] = useState(filterCount > 0);
  const activeBrand = brands.find((b) => b.active) ?? brands[0];

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[13px]">
          {/* Brand switcher — the quiet parent segment */}
          <div className="relative">
            <button
              onClick={() => setBrandOpen((o) => !o)}
              className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-[12.5px] font-medium text-muted transition-colors hover:bg-[#f1efe9] hover:text-ink-soft"
            >
              {activeBrand?.name}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cx("text-muted/60 transition-transform group-hover:text-ink-soft", brandOpen && "rotate-180")}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {brandOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setBrandOpen(false)} aria-hidden />
                <div className="absolute left-0 z-30 mt-1 max-h-[60vh] w-56 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
                  {brands.map((b) => (
                    <Link
                      key={b.id}
                      href={b.href}
                      onClick={() => setBrandOpen(false)}
                      className={cx(
                        "block truncate rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                        b.active ? "bg-[#fbf8f1] text-brass" : "text-ink hover:bg-[#faf9f5]"
                      )}
                    >
                      {b.name}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-line"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <div className="relative">
            <button
              onClick={() => setCatOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 font-semibold text-ink transition-colors hover:bg-[#f1efe9]"
            >
              {activeLabel}
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cx("text-ink-soft transition-transform", catOpen && "rotate-180")}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {catOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setCatOpen(false)} aria-hidden />
                <div className="absolute left-0 z-30 mt-1 max-h-[60vh] w-72 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
                  {categories.map((c) => (
                    <Link
                      key={c.id}
                      href={c.href}
                      onClick={() => setCatOpen(false)}
                      className={cx(
                        "flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 transition-colors",
                        c.active ? "bg-[#fbf8f1]" : "hover:bg-[#faf9f5]"
                      )}
                    >
                      <span className="min-w-0">
                        <span className={cx("block truncate text-[13px] font-medium", c.active ? "text-brass" : "text-ink")}>{c.name}</span>
                        <span className="block text-[11px] text-muted">{c.count} models</span>
                      </span>
                      {c.orderable ? <Badge tone="green">Orderable</Badge> : <Badge tone="slate">Reference</Badge>}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </nav>

        {/* Search + Filters */}
        <div className="ml-auto flex items-center gap-2">
          {/* These slots arrive as props from a Server Component; across the RSC boundary the
              children array loses its "static" marking, so React key-validates it. Keyed wrappers
              keep the dev warning quiet. */}
          <Fragment key="search">{searchSlot}</Fragment>
          {frequentSlot ? <Fragment key="frequent">{frequentSlot}</Fragment> : null}
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className={cx(
              "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors",
              filtersOpen || filterCount > 0 ? "border-ink text-ink" : "border-line text-ink-soft hover:border-ink"
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            </svg>
            Filters
            {filterCount > 0 && (
              <span className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-ink px-1.5 text-[10.5px] font-semibold text-white">
                {filterCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c, i) => (
            <Link
              key={i}
              href={c.href}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              {c.label}
              <span className="text-muted">✕</span>
            </Link>
          ))}
          <Link href={clearAllHref} className="text-[11.5px] font-medium text-muted hover:text-ink">
            Clear all
          </Link>
        </div>
      )}

      {/* Collapsible filter panel */}
      {filtersOpen && <Card className="p-3">{filtersSlot}</Card>}
    </div>
  );
}
