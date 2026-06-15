import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { requireUserId } from "@/lib/auth/user";
import { getOrders } from "@/lib/db";
import { fmtDate, usd } from "@/lib/format";

export default async function OrdersPage() {
  const ownerId = await requireUserId("/orders");
  const orders = await getOrders(ownerId);

  return (
    <div>
      <PageHeader
        eyebrow="Fulfillment"
        title="Pre-Orders"
        description="Confirmed quotes flowing through the China supply chain. Status updates sync automatically from the supplier and logistics layer."
      />

      {orders.length === 0 ? (
        <EmptyState
          title="No pre-orders yet"
          description="Submit a draft quote and it becomes a pre-order tracked here, end to end."
          action={<LinkButton href="/quotes">Go to quotes</LinkButton>}
        />
      ) : (
        <Card className="overflow-hidden">
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
              {orders.map((o) => (
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
                  <td className="px-5 py-3.5 text-right font-semibold tabular-nums text-ink">{usd(o.total)}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-muted">{fmtDate(o.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
