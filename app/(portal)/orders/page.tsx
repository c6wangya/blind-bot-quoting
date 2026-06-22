import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { ListToolbar } from "@/components/ListToolbar";
import { requireUserId, userClient } from "@/lib/auth/user";
import { getOrders } from "@/lib/db";
import { fmtDate, ORDER_STATUS_META, usd } from "@/lib/format";
import { pageSlice, parseListParams, PAGE_SIZE } from "@/lib/list";

const ORDER_STATUS_OPTIONS = Object.entries(ORDER_STATUS_META).map(([value, m]) => ({ value, label: m.label }));

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ownerId = await requireUserId("/orders");
  const all = await getOrders(ownerId, await userClient());
  const { q, status, page } = parseListParams(await searchParams);
  const ql = q.toLowerCase();
  const filtered = all.filter(
    (o) =>
      (!status || o.status === status) &&
      (!q || `${o.ref} ${o.projectName ?? ""} ${o.supplierOrderNo ?? ""} ${o.trackingNo ?? ""}`.toLowerCase().includes(ql))
  );
  const rows = pageSlice(filtered, page);

  return (
    <div>
      <PageHeader
        eyebrow="Fulfillment"
        title="Pre-Orders"
        description="Confirmed quotes flowing through the China supply chain. Status updates sync automatically from the supplier and logistics layer."
      />

      {all.length === 0 ? (
        <EmptyState
          title="No pre-orders yet"
          description="Submit a draft quote and it becomes a pre-order tracked here, end to end."
          action={<LinkButton href="/quotes">Go to quotes</LinkButton>}
        />
      ) : (
        <>
        <ListToolbar basePath="/orders" q={q} status={status} statuses={ORDER_STATUS_OPTIONS} total={filtered.length} page={page} pageSize={PAGE_SIZE} />

        {/* Mobile: cards */}
        <div className="space-y-3 md:hidden">
          {rows.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="block rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-ink">{o.ref}</span>
                <StatusBadge status={o.status} />
              </div>
              {o.projectName && <div className="mt-1 truncate text-[13px] text-muted">{o.projectName}</div>}
              <div className="mt-2 flex items-center justify-between text-[13px]">
                <span className="text-muted">{fmtDate(o.updatedAt)}</span>
                <span className="font-semibold tabular-nums text-ink">{usd(o.amount ?? o.total)}</span>
              </div>
            </Link>
          ))}
          {rows.length === 0 && <p className="py-8 text-center text-sm text-muted">No pre-orders match your search.</p>}
        </div>

        {/* Desktop: table */}
        <Card className="hidden overflow-hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#fafaf7] text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Pre-order</th>
                <th className="px-5 py-3">Project</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Supplier order №</th>
                <th className="px-5 py-3">Tracking</th>
                <th className="px-5 py-3 text-right">Total</th>
                <th className="px-5 py-3 text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} className="group border-b border-line/60 transition-colors last:border-0 hover:bg-[#fbfaf6]">
                  <td className="px-5 py-3.5">
                    <Link href={`/orders/${o.id}`} className="font-semibold text-ink group-hover:text-brass">
                      {o.ref}
                    </Link>
                  </td>
                  <td className="max-w-44 truncate px-5 py-3.5 text-ink-soft">{o.projectName ?? "—"}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-ink-soft">{o.supplierOrderNo ?? "—"}</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-ink-soft">{o.trackingNo ?? "—"}</td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-ink">{usd(o.amount ?? o.total)}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-muted">{fmtDate(o.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No pre-orders match your search.</p>}
        </Card>
        </>
      )}
    </div>
  );
}
