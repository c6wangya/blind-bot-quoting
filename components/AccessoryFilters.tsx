"use client";

import { useRouter } from "next/navigation";
import type { AttributeWithValues } from "@/lib/db";

const BASE = "/catalog/accessories";

/** Retailer faceted filter for the accessory catalog. One dropdown per attribute; AND across. */
export function AccessoryFilters({
  attributes,
  selected,
  cat,
}: {
  attributes: AttributeWithValues[];
  selected: Record<string, string>;
  cat?: string;
}) {
  const router = useRouter();
  const withValues = attributes.filter((a) => a.values.length > 0);
  if (withValues.length === 0) return null;

  const build = (sel: Record<string, string>) => {
    const p = new URLSearchParams();
    if (cat) p.set("cat", cat);
    for (const [k, v] of Object.entries(sel)) if (v) p.set(`t_${k}`, v);
    const qs = p.toString();
    return qs ? `${BASE}?${qs}` : BASE;
  };

  const setFilter = (attrId: string, valueId: string) => {
    const sel = { ...selected };
    if (valueId) sel[attrId] = valueId;
    else delete sel[attrId];
    router.push(build(sel));
  };

  const anyActive = Object.keys(selected).length > 0;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {withValues.map((a) => (
        <label key={a.id} className="flex flex-col gap-1">
          <span className="px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{a.name}</span>
          <select
            value={selected[a.id] ?? ""}
            onChange={(e) => setFilter(a.id, e.target.value)}
            className="min-w-[150px] rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-ink"
          >
            <option value="">Any</option>
            {a.values.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {anyActive && (
        <button
          onClick={() => router.push(build({}))}
          className="rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-[#faf9f5]"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
