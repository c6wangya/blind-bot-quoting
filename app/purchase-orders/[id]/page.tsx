import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintInvoiceButton } from "@/components/InvoiceActions";
import { canAccessOwned, userClient } from "@/lib/auth/user";
import { getActingContext } from "@/lib/auth/acting-as";
import { admin } from "@/lib/supabase/admin";
import { BRAND } from "@/lib/brand";
import { getOrder, getOrderOwnerId } from "@/lib/db";
import { buildPurchaseOrderDoc } from "@/lib/purchase-order";

const num2 = (n: number) => n.toFixed(2);

/**
 * Standalone, printable Purchase Order for one brand of an order — the document sent to that
 * supplier to reconcile goods. No portal chrome (prints clean; the browser print dialog is the
 * PDF export). Laid out after the supplier's own Commercial Invoice (core sections only): supplier
 * banner on top, our buyer block + invoice meta, the parts table, the goods total, and the
 * supplier's bank details. Content is built by buildPurchaseOrderDoc so the .xlsx export matches.
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

  const doc = await buildPurchaseOrderDoc(order, brand);
  if (!doc) notFound();

  const sup = doc.supplier;

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
        {/* Supplier banner — centered, like the reference commercial invoice */}
        <div className="border-b border-line pb-4 text-center">
          <div className="text-lg font-bold uppercase tracking-wide text-ink">{doc.supplierName}</div>
          {sup?.addressLines.map((l, i) => (
            <div key={i} className="text-[12px] text-muted">
              {l}
            </div>
          ))}
          {sup && (sup.tel || sup.fax || sup.website) && (
            <div className="mt-0.5 text-[12px] text-muted">
              {[sup.tel && `Tel: ${sup.tel}`, sup.fax && `Fax: ${sup.fax}`, sup.website].filter(Boolean).join("      ")}
            </div>
          )}
        </div>

        {/* Document title */}
        <div className="mt-5 text-center text-2xl font-light uppercase tracking-[0.2em] text-ink">Purchase Order</div>

        {/* Buyer (our purchasing company) on the left, invoice meta on the right */}
        <div className="mt-6 flex justify-between gap-8">
          <div className="space-y-0.5 text-[12.5px]">
            <div className="flex gap-2">
              <span className="w-16 shrink-0 font-semibold text-muted">Buyer:</span>
              <span className="font-semibold text-ink">{doc.buyerName}</span>
            </div>
            {doc.buyer.attn && (
              <div className="flex gap-2">
                <span className="w-16 shrink-0 text-muted">Attn:</span>
                <span className="text-ink">{doc.buyer.attn}</span>
              </div>
            )}
            {doc.buyer.addressLines.length > 0 && (
              <div className="flex gap-2">
                <span className="w-16 shrink-0 text-muted">Address:</span>
                <span className="text-ink">{doc.buyer.addressLines.join(", ")}</span>
              </div>
            )}
            {(doc.buyer.tel || doc.buyer.email) && (
              <div className="flex gap-2">
                <span className="w-16 shrink-0 text-muted">Tel:</span>
                <span className="text-ink">{[doc.buyer.tel, doc.buyer.email].filter(Boolean).join("   ")}</span>
              </div>
            )}
          </div>
          <table className="text-[12.5px]">
            <tbody>
              {doc.meta.map(([k, v]) => (
                <tr key={k}>
                  <td className="py-0.5 pr-6 text-muted">{k}</td>
                  <td className="py-0.5 text-right text-ink">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Parts table — Item · Part No. · Description · Qty · Unit Price · Amount */}
        <table className="mt-6 w-full border-collapse text-[13px]">
          <colgroup>
            <col className="w-10" />
            <col className="w-28" />
            <col />
            <col className="w-16" />
            <col className="w-24" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="bg-[#3a3a3a] text-left font-normal text-white">
              <th className="px-3 py-2.5 text-center font-normal">Item</th>
              <th className="px-3 py-2.5 font-normal">Part No.</th>
              <th className="px-3 py-2.5 font-normal">Description</th>
              <th className="px-3 py-2.5 text-right font-normal">Qty</th>
              <th className="px-3 py-2.5 text-right font-normal">Unit Price</th>
              <th className="px-3 py-2.5 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.rows.map((r, i) => (
              <tr key={i} className="border-b border-[#e6e3db] align-top">
                <td className="px-3 py-3 text-center text-ink">
                  {r.sub ? "" : doc.rows.slice(0, i + 1).filter((x) => !x.sub).length}
                </td>
                <td className="px-3 py-3 text-[12px] text-ink-soft">{r.sku ?? ""}</td>
                <td className="px-3 py-3">
                  <div className={r.sub ? "pl-4 text-[12.5px] text-ink-soft" : "text-ink"}>
                    {r.sub ? "↳ " : ""}
                    {r.name}
                  </div>
                  {r.detail && <div className={`mt-0.5 text-[12px] text-[#8a8a8a] ${r.sub ? "pl-4" : ""}`}>{r.detail}</div>}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">{r.qty}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">{num2(r.rate)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">{num2(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Total — goods only (no shipping, no payment) */}
        <div className="mt-4 flex justify-end">
          <table className="w-[300px] text-[13px]">
            <tbody>
              <tr className="bg-[#f3f1ec]">
                <td className="py-3 pl-4 text-right font-bold text-ink">Total Amount</td>
                <td className="py-3 pl-8 pr-4 text-right font-bold tabular-nums text-ink">${num2(doc.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Supplier bank details — where the buyer remits payment for these goods */}
        {doc.bank.length > 0 && (
          <div className="mt-8 border-t border-line pt-6">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Bank Information</div>
            <table className="mt-2 text-[12.5px]">
              <tbody>
                {doc.bank.map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-0.5 pr-6 align-top text-muted">{k}</td>
                    <td className="py-0.5 text-ink">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-10 border-t border-line pt-6 text-[12px] text-muted">
          This purchase order lists the goods for supplier{" "}
          <span className="font-medium text-ink">{doc.supplierName}</span> on order {order.ref}. For goods
          reconciliation only — pricing excludes shipping.
        </div>
      </div>
    </div>
  );
}
