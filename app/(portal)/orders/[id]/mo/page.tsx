import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/user";
import { getDefaultOrgId, getOrder, listDeductionRows } from "@/lib/db";
import { isWindowConfig, type WindowQuoteComputation } from "@/lib/window/quote";
import { formatInches } from "@/lib/window/quote";
import { deriveCutList, matchDeductionRow } from "@/lib/window/production";
import { BackLink, Badge, Card, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Manufacturing Order (MO) — the shop-floor cut sheet for an order's window lines, derived
 * entirely from line snapshots + the org's deduction tables (the anchor factory's
 * "Deductions"-sheet model: cut = ordered size + per-component offset by mount × top style).
 * Admin-only; print-friendly.
 */
export default async function ManufacturingOrderPage(ctx: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/orders");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) notFound();

  const order = await getOrder(id);
  if (!order) notFound();

  const windowItems = order.quote.items.filter((it) => isWindowConfig(it.config));
  if (windowItems.length === 0) notFound();

  const orgId = await getDefaultOrgId();
  const deductions = await listDeductionRows(orgId);

  const totalUnits = windowItems.reduce((s, it) => s + it.qty, 0);
  let unitCounter = 0;

  return (
    <div className="mx-auto max-w-4xl print:max-w-none">
      <div className="print:hidden">
        <BackLink href={`/orders/${order.id}`}>Order {order.ref}</BackLink>
      </div>
      <PageHeader
        title={`Manufacturing Order — ${order.ref}`}
        description={[
          order.quote.po ? `PO ${order.quote.po}` : null,
          order.quote.sidemark ? `Sidemark ${order.quote.sidemark}` : null,
          `${windowItems.length} lines · ${totalUnits} units`,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="space-y-4">
        {windowItems.map((item, idx) => {
          if (!isWindowConfig(item.config)) return null;
          const cfg = item.config;
          const comp = item.computation as WindowQuoteComputation;
          const row = matchDeductionRow(deductions, comp.window.lineKey, cfg.selections);
          const cuts = row ? deriveCutList(row, cfg) : null;
          return (
            <Card key={item.id} className="p-5 print:break-inside-avoid">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[15px] font-semibold text-ink">
                    #{idx + 1} · {comp.window.productName}
                    {cfg.room ? ` — ${cfg.room}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    Ordered {formatInches(cfg.widthIn)} W × {formatInches(cfg.heightIn)} H · Qty {item.qty}
                    {cfg.parentItemId ? " · 2-on-1 child" : ""}
                  </div>
                </div>
                {row ? (
                  <Badge className="border-line bg-black/[.03] text-ink-soft">{row.label}</Badge>
                ) : (
                  <Badge className="border-amber-200 bg-amber-50 text-amber-700">manual engineering</Badge>
                )}
              </div>

              {cuts && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                        <th className="py-1 pr-4 font-semibold">Component</th>
                        <th className="py-1 pr-4 font-semibold">Cut</th>
                        <th className="py-1 font-semibold">Offset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cuts.map((c) => {
                        const component = row!.components[c.componentKey];
                        return (
                          <tr key={c.componentKey} className="border-t border-line/50">
                            <td className="py-1.5 pr-4 font-medium text-ink">{c.label}</td>
                            <td className="py-1.5 pr-4 tabular-nums text-ink">{c.display}</td>
                            <td className="py-1.5 text-xs tabular-nums text-muted">
                              {component.base} {component.offset >= 0 ? "+" : "−"}
                              {formatInches(Math.abs(component.offset))}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* option facts for the floor + special instructions */}
              <div className="mt-3 border-t border-line/50 pt-2 text-xs text-ink-soft">
                {comp.facts
                  .filter((f) => f.label !== "Size")
                  .map((f) => `${f.label}: ${f.value}`)
                  .join(" · ")}
              </div>
              {cfg.specialInstructions && (
                <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
                  ★ {cfg.specialInstructions}
                </div>
              )}

              {/* per-unit labels */}
              <div className="mt-3 flex flex-wrap gap-2">
                {Array.from({ length: item.qty }, (_, u) => {
                  unitCounter++;
                  return (
                    <div
                      key={u}
                      className="rounded border border-dashed border-line px-3 py-2 text-[10.5px] leading-4 text-ink-soft"
                    >
                      <div className="font-semibold text-ink">
                        {unitCounter} of {totalUnits} · {order.ref}
                      </div>
                      <div>
                        {order.quote.po ? `PO: ${order.quote.po} · ` : ""}
                        {order.quote.sidemark ? `SM: ${order.quote.sidemark}` : ""}
                      </div>
                      <div>
                        {formatInches(cfg.widthIn)} × {formatInches(cfg.heightIn)}
                        {cfg.room ? ` · ${cfg.room}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-muted print:hidden">
        Cut sizes derive from the deduction tables (Window Products → Deductions). Lines marked
        “manual engineering” matched no deduction rule.
      </p>
    </div>
  );
}
