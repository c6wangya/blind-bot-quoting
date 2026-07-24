import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/user";
import { getOrder } from "@/lib/db";
import { isWindowConfig, formatInches, type WindowQuoteComputation } from "@/lib/window/quote";
import { deriveAggregates } from "@/lib/window/production";
import { BackLink, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Packing slip for an order's window lines — ships with the boxes. One row per line with
 * check-off boxes, loose-parts counts (remotes/chargers/hubs ship separately from shades),
 * and the ship-to block. Admin-only, print-friendly.
 */
export default async function PackingSlipPage(ctx: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/orders");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) notFound();

  const order = await getOrder(id);
  if (!order) notFound();
  const windowItems = order.quote.items.filter((it) => isWindowConfig(it.config));
  if (windowItems.length === 0) notFound();

  const q = order.quote;
  const agg = deriveAggregates(
    windowItems.map((it) => ({
      selections: (it.config as unknown as { selections: Record<string, unknown> }).selections ?? {},
      qty: it.qty,
    }))
  );
  const loose: [string, number][] = [
    ["Remotes", agg.remoteUnits],
    ["Chargers", agg.chargerUnits],
    ["Smart hubs", agg.hubUnits],
    ["Battery packs", agg.batteryPackUnits],
    ["Side channel sets", agg.sideChannelUnits],
    ["Hold-down magnets", agg.holdDownUnits],
  ];

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <div className="print:hidden">
        <BackLink href={`/orders/${order.id}`}>Order {order.ref}</BackLink>
      </div>
      <PageHeader
        title={`Packing Slip — ${order.ref}`}
        description={[
          q.po ? `PO ${q.po}` : null,
          q.sidemark ? `Sidemark ${q.sidemark}` : null,
          `${agg.totalUnits} units`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      {/* ship-to */}
      {(q.customerName || q.shipAddress1) && (
        <Card className="mb-4 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Ship to</div>
          <div className="mt-1 text-sm text-ink">
            {q.customerName && <div className="font-semibold">{q.customerName}</div>}
            {q.shipAddress1 && <div>{q.shipAddress1}</div>}
            {q.shipAddress2 && <div>{q.shipAddress2}</div>}
            {(q.shipCity || q.shipState || q.shipZip) && (
              <div>
                {[q.shipCity, q.shipState].filter(Boolean).join(", ")} {q.shipZip}
              </div>
            )}
            {q.customerPhone && <div className="text-xs text-muted">{q.customerPhone}</div>}
          </div>
        </Card>
      )}

      {/* lines */}
      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-5 py-2 font-semibold">✓</th>
              <th className="py-2 pr-4 font-semibold">#</th>
              <th className="py-2 pr-4 font-semibold">Item</th>
              <th className="py-2 pr-4 font-semibold">Size</th>
              <th className="py-2 pr-4 font-semibold">Room</th>
              <th className="py-2 pr-5 text-right font-semibold">Qty</th>
            </tr>
          </thead>
          <tbody>
            {windowItems.map((item, i) => {
              const cfg = item.config as unknown as { widthIn: number; heightIn: number; room?: string };
              const comp = item.computation as WindowQuoteComputation;
              return (
                <tr key={item.id} className="border-b border-line/50">
                  <td className="px-5 py-2">
                    <input type="checkbox" className="size-4 accent-ink" />
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-muted">{i + 1}</td>
                  <td className="py-2 pr-4 font-medium text-ink">{comp.window.productName}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {formatInches(cfg.widthIn)} × {formatInches(cfg.heightIn)}
                  </td>
                  <td className="py-2 pr-4 text-ink-soft">{cfg.room ?? ""}</td>
                  <td className="py-2 pr-5 text-right tabular-nums">{item.qty}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* loose parts */}
      {loose.some(([, n]) => n > 0) && (
        <Card className="mt-4 p-5">
          <div className="text-sm font-semibold text-ink">Loose parts in this shipment</div>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {loose
              .filter(([, n]) => n > 0)
              .map(([label, n]) => (
                <label key={label} className="flex items-center gap-1.5 text-xs text-ink-soft">
                  <input type="checkbox" className="size-3.5 accent-ink" />
                  <span className="font-semibold tabular-nums text-ink">{n}</span> {label}
                </label>
              ))}
          </div>
        </Card>
      )}

      <p className="mt-4 text-xs text-muted print:hidden">
        Packed by ________________ · Date ____________
      </p>
    </div>
  );
}
