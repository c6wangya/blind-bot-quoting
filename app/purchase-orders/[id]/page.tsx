import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintInvoiceButton } from "@/components/InvoiceActions";
import { canAccessOwned, userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import { BRAND } from "@/lib/brand";
import { getOrder, getOrderOwnerId } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { getSeller } from "@/lib/invoice";
import { buildPurchaseOrderRows } from "@/lib/purchase-order";
import { isAccessoryConfig } from "@/lib/types";

const num2 = (n: number) => n.toFixed(2);
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Standalone, printable Purchase Order for one brand of an order — the document sent to that
 * supplier to reconcile goods. No portal chrome (prints clean; the browser print dialog is the
 * PDF export), no payment, no shipping: just the parts (main motor + each accessory sub-part) with
 * counts and unit prices. Buyer = our white-label brand; vendor = the brand string.
 */
export default async function PurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ brand?: string }>;
}) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) notFound();
  const { brand } = await searchParams;
  if (!brand) notFound();

  // Same identity model as the order page: admin acting on behalf reads as that retailer
  // (service_role), a plain retailer reads their own (RLS); admins may view any order.
  const ctx = await getActingContext();
  if (!ctx.realUid) redirect(`/login?next=${encodeURIComponent(`/purchase-orders/${id}?brand=${brand}`)}`);
  const sb = ctx.actingAsId ? admin() : await userClient();
  if (!(await canAccessOwned(ctx.realUid, await getOrderOwnerId(orderId)))) notFound();

  const order = await getOrder(orderId, sb);
  if (!order) notFound();
  const seller = await getSeller();

  const brandOf = (it: (typeof order.quote.items)[number]) =>
    isAccessoryConfig(it.config) ? it.config.brand : BRAND.name;
  const items = order.quote.items.filter((it) => brandOf(it) === brand);
  if (items.length === 0) notFound();

  const rows = buildPurchaseOrderRows(items);
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const q = order.quote;
  const meta: [string, string][] = [
    ["Order №", order.ref],
    ["Quote Ref", q.ref],
    ["Date", fmtDate(order.createdAt)],
    ...(q.projectName ? ([["Project", q.projectName]] as [string, string][]) : []),
    ...(q.po ? ([["PO #", q.po]] as [string, string][]) : []),
    ...(q.sidemark ? ([["Sidemark", q.sidemark]] as [string, string][]) : []),
  ];

  return (
    <div className="min-h-screen bg-[#f4f2ec] py-6 print:bg-white print:py-0">
      {/* Action bar — hidden when printing */}
      <div className="mx-auto mb-5 flex max-w-3xl items-center justify-between gap-3 px-4 print:hidden">
        <Link href={`/orders/${order.id}`} className="text-sm font-medium text-muted hover:text-ink">
          ← Back to {order.ref}
        </Link>
        <PrintInvoiceButton fileName={`${BRAND.name} PO ${order.ref} ${brand}`} />
      </div>

      {/* PO sheet */}
      <div className="mx-auto max-w-3xl bg-white px-10 py-10 text-[13px] text-ink shadow-sm ring-1 ring-line [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:max-w-none print:shadow-none print:ring-0">
        {/* Header */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brass to-[#8a6a39] text-lg font-bold text-white">
              {BRAND.monogram}
            </div>
            <div className="mt-3 text-base font-bold text-ink">{seller.name}</div>
            {seller.addressLines.map((l, i) => (
              <div key={i} className="text-[12px] text-muted">
                {l}
              </div>
            ))}
            <div className="mt-1 text-[12px] text-muted">Tax ID: {seller.taxId}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-light uppercase tracking-wide text-ink">Purchase Order</div>
            <div className="mt-1 text-[13px] font-semibold text-ink"># {order.ref}</div>
          </div>
        </div>

        {/* Vendor + meta */}
        <div className="mt-8 flex justify-between gap-8">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Vendor</div>
            <div className="mt-1 text-[15px] font-semibold text-ink">{brand}</div>
            <div className="text-[12px] text-muted">Supplier · goods reconciliation</div>
          </div>
          <table className="text-[12.5px]">
            <tbody>
              {meta.map(([k, v]) => (
                <tr key={k}>
                  <td className="py-0.5 pr-6 text-muted">{k}</td>
                  <td className="py-0.5 text-right text-ink">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Parts table — main motor + each accessory sub-part, with counts + unit price */}
        <table className="mt-8 w-full border-collapse text-[13px]">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-20" />
            <col className="w-24" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="bg-[#3a3a3a] text-left font-normal text-white">
              <th className="px-4 py-2.5 text-center font-normal">#</th>
              <th className="px-4 py-2.5 font-normal">Item &amp; Description</th>
              <th className="px-4 py-2.5 text-right font-normal">Qty</th>
              <th className="px-4 py-2.5 text-right font-normal">Unit Price</th>
              <th className="px-4 py-2.5 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[#e6e3db] align-top">
                <td className="px-4 py-3.5 text-center text-ink">{r.sub ? "" : rows.slice(0, i + 1).filter((x) => !x.sub).length}</td>
                <td className="px-4 py-3.5">
                  <div className={r.sub ? "pl-4 text-[12.5px] text-ink-soft" : "text-ink"}>
                    {r.sub ? "↳ " : ""}
                    {r.sku ? `${r.name} ${r.sku}` : r.name}
                  </div>
                  {r.detail && <div className={`mt-0.5 text-[12px] text-[#8a8a8a] ${r.sub ? "pl-4" : ""}`}>{r.detail}</div>}
                </td>
                <td className="px-4 py-3.5 text-right tabular-nums text-ink">{r.qty}</td>
                <td className="px-4 py-3.5 text-right tabular-nums text-ink">{num2(r.rate)}</td>
                <td className="px-4 py-3.5 text-right tabular-nums text-ink">{num2(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Total — goods only (no shipping, no payment) */}
        <div className="mt-4 flex justify-end">
          <table className="w-[300px] text-[13px]">
            <tbody>
              <tr className="bg-[#f3f1ec]">
                <td className="py-3 pl-4 text-right font-bold text-ink">Total</td>
                <td className="py-3 pl-8 pr-4 text-right font-bold tabular-nums text-ink">${num2(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-10 border-t border-line pt-6 text-[12px] text-muted">
          This purchase order lists the goods for vendor <span className="font-medium text-ink">{brand}</span> on
          order {order.ref}. For goods reconciliation only — pricing excludes shipping.
        </div>
      </div>
    </div>
  );
}
