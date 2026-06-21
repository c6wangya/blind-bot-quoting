import Link from "next/link";
import { Input, Select } from "./ui";

export type StatusOption = { value: string; label: string };

/**
 * Server-rendered list toolbar: a GET search form (+ optional status select) and a pager.
 * No client JS — searching/filtering navigates with query params; the page re-renders.
 */
export function ListToolbar({
  basePath,
  q,
  status,
  statuses,
  total,
  page,
  pageSize,
}: {
  basePath: string;
  q: string;
  status: string;
  statuses?: StatusOption[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const href = (next: { page?: number }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    const p = next.page ?? 1;
    if (p > 1) sp.set("page", String(p));
    const s = sp.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <form action={basePath} method="get" className="flex flex-wrap items-center gap-2">
        <Input name="q" defaultValue={q} placeholder="Search…" aria-label="Search" className="w-auto py-1.5" />
        {statuses && statuses.length > 0 && (
          <Select name="status" defaultValue={status} aria-label="Filter by status" className="w-auto py-1.5">
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
        <button type="submit" className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-[#faf9f5]">
          Search
        </button>
        {(q || status) && (
          <Link href={basePath} className="text-[12px] text-muted hover:underline">
            Clear
          </Link>
        )}
      </form>

      <div className="ml-auto flex items-center gap-3 text-[12px] text-muted">
        <span>
          {total} result{total === 1 ? "" : "s"}
        </span>
        {totalPages > 1 && (
          <span className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={href({ page: page - 1 })} className="font-medium text-brass hover:underline">
                ‹ Prev
              </Link>
            ) : (
              <span className="opacity-30">‹ Prev</span>
            )}
            <span>
              {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={href({ page: page + 1 })} className="font-medium text-brass hover:underline">
                Next ›
              </Link>
            ) : (
              <span className="opacity-30">Next ›</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
