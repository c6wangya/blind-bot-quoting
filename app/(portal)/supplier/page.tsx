import Link from "next/link";
import SupplierAdvanceButton from "@/components/SupplierActions";
import { ListToolbar } from "@/components/ListToolbar";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireAdminPage } from "@/lib/auth/user";
import { expireStaleAwaitingOrders, getOrders } from "@/lib/db";
import { fmtDate, ORDER_STATUS_META, usd } from "@/lib/format";
import { pageSlice, parseListParams, PAGE_SIZE } from "@/lib/list";

const ORDER_STATUS_OPTIONS = Object.entries(ORDER_STATUS_META).map(([value, m]) => ({ value, label: m.label }));

export default async function SupplierConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage("/supplier");
  await expireStaleAwaitingOrders().catch(() => {}); // lazy sweep of abandoned unpaid orders
  const all = await getOrders();
  const { q, status, page } = parseListParams(await searchParams);
  const ql = q.toLowerCase();
  const filtered = all.filter(
    (o) =>
      (!status || o.status === status) &&
      (!q || `${o.ref} ${o.retailer} ${o.projectName ?? ""} ${o.supplierOrderNo ?? ""}`.toLowerCase().includes(ql))
  );
  const orders = pageSlice(filtered, page);

  return (
    <div>
      <PageHeader
        eyebrow="Supply chain"
        title="Supplier Console"
        description="Stands in for the China supplier's system and the logistics layer: acknowledge orders, issue order and tracking numbers, and push status — exactly the events the production integration will deliver."
      />

      <Card className="rise mb-6 border-amber-200 bg-amber-50/60 px-5 py-3.5">
        <p className="text-[13px] text-amber-900">
          <span className="font-semibold">Simulation surface.</span>&nbsp; In production these events arrive from the
          supplier&apos;s order system (order №, production status) and the logistics provider (tracking, delivery) —
          this console lets you drive the pipeline end-to-end for the demo.
        </p>
      </Card>

      {all.length === 0 ? (
        <EmptyState
          title="Nothing in the pipeline"
          description="Pre-orders submitted by retailers appear here for fulfillment."
        />
      ) : (
        <>
        <ListToolbar basePath="/supplier" q={q} status={status} statuses={ORDER_STATUS_OPTIONS} total={filtered.length} page={page} pageSize={PAGE_SIZE} />

        {/* Mobile: cards */}
        <div className="space-y-3 md:hidden">
          {orders.map((o) => (
            <div key={o.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <Link href={`/orders/${o.id}`} className="font-semibold text-ink hover:text-brass">{o.ref}</Link>
                <StatusBadge status={o.status} />
              </div>
              <div className="mt-1 truncate text-[13px] text-muted">{o.retailer}{o.projectName ? ` · ${o.projectName}` : ""}</div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[13px] font-semibold tabular-nums text-ink">{usd(o.total)}</span>
                <SupplierAdvanceButton orderId={o.id} status={o.status} paymentMethod={o.paymentMethod} paymentStatus={o.paymentStatus} />
              </div>
            </div>
          ))}
          {orders.length === 0 && <p className="py-8 text-center text-sm text-muted">No orders match your search.</p>}
        </div>

        {/* Desktop: table */}
        <Card className="hidden overflow-hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-[#fafaf7] text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Retailer</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Supplier №</th>
                <th className="px-5 py-3 text-right">Value</th>
                <th className="px-5 py-3 text-right">Received</th>
                <th className="px-5 py-3 text-right">Next event</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-3.5">
                    <Link href={`/orders/${o.id}`} className="font-semibold text-ink hover:text-brass">
                      {o.ref}
                    </Link>
                    <a
                      href={`/api/orders/${o.id}/excel`}
                      className="ml-2 text-[11px] font-medium text-brass hover:underline"
                      title="Download the order file as the supplier receives it"
                    >
                      .xlsx
                    </a>
                  </td>
                  <td className="px-5 py-3.5 text-ink-soft">{o.retailer}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-ink-soft">{o.supplierOrderNo ?? "—"}</td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-ink">{usd(o.total)}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-muted">{fmtDate(o.createdAt)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <SupplierAdvanceButton orderId={o.id} status={o.status} paymentMethod={o.paymentMethod} paymentStatus={o.paymentStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">No orders match your search.</p>}
        </Card>
        </>
      )}
    </div>
  );
}
