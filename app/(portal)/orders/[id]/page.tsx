import Link from "next/link";
import { notFound } from "next/navigation";
import { Swatch } from "@/components/renders";
import { BackLink, Badge, Card, cx, PageHeader, StatusBadge } from "@/components/ui";
import { OrderPayment } from "@/components/OrderPayment";
import { canAccessOwned, isAdmin, requireUserId, userClient } from "@/lib/auth/user";
import { admin } from "@/lib/supabase/admin";
import { getBankInfo, getLine, getOrder, getOrderOwnerId, getProduct, loadCatalog } from "@/lib/db";
import { describeConfig } from "@/lib/describe";
import { isAccessoryConfig } from "@/lib/types";
import { ACTOR_LABEL, fmtDate, fmtDateTime, ORDER_STATUS_META, usd } from "@/lib/format";
import { ORDER_STATUSES } from "@/lib/types";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId(`/orders/${id}`);
  const order = await getOrder(Number(id), await userClient());
  if (!order) notFound();

  if (!(await canAccessOwned(userId, await getOrderOwnerId(Number(id))))) notFound();

  const catalog = await loadCatalog(); // for accessory line images / names
  const stageIdx = ORDER_STATUSES.indexOf(order.status as (typeof ORDER_STATUSES)[number]);

  // Payment layer (retailer view; admin confirmation lives in the Supplier Console)
  const bankInfo = order.paymentMethod === "bank_transfer" ? await getBankInfo() : null;
  let proofUrl: string | null = null;
  if (order.paymentProofPath) {
    const { data } = await admin().storage.from("payment-proofs").createSignedUrl(order.paymentProofPath, 3600);
    proofUrl = data?.signedUrl ?? null;
  }
  const transferReported = order.events?.some((e) => e.note.includes("reported the bank transfer")) ?? false;
  const adminUser = await isAdmin(userId);

  return (
    <div>
      <BackLink href={adminUser ? "/supplier" : "/orders"}>{adminUser ? "Supplier Console" : "All pre-orders"}</BackLink>
      <PageHeader
        eyebrow={`Pre-order · placed ${fmtDate(order.createdAt)}`}
        title={order.ref}
        description={order.quote.projectName ?? undefined}
        actions={
          <a
            href={`/api/orders/${order.id}/excel`}
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#2a3756] hover:shadow"
          >
            ⬇ Supplier order file (.xlsx)
          </a>
        }
      />

      <div className="rise mb-6">
        {order.status === "cancelled" ? (
          <Card className="border-line bg-[#faf9f5] px-5 py-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Order cancelled</h3>
              <StatusBadge status="cancelled" />
            </div>
            <p className="mt-2 text-[13px] text-ink-soft">
              This pre-order was cancelled before payment. The quote has been reopened for editing —{" "}
              <Link href={`/quotes/${order.quoteId}`} className="font-medium text-brass hover:underline">
                edit quote {order.quote.ref} →
              </Link>
            </p>
          </Card>
        ) : (
          <OrderPayment
            orderId={order.id}
            method={order.paymentMethod}
            paymentStatus={order.paymentStatus}
            amountLabel={usd(order.amount ?? order.quote.total)}
            bankInfo={bankInfo}
            proofUrl={proofUrl}
            transferReported={transferReported}
          />
        )}
      </div>

      {/* status stepper — once the order is in the fulfilment pipeline */}
      {stageIdx >= 0 && (
      <Card className="rise px-6 py-5">
        <div className="flex items-center">
          {ORDER_STATUSES.map((s, i) => {
            const reached = i <= stageIdx;
            const meta = ORDER_STATUS_META[s];
            return (
              <div key={s} className={cx("flex items-center", i < ORDER_STATUSES.length - 1 && "flex-1")}>
                <div className="flex flex-col items-center">
                  <div
                    className={cx(
                      "flex size-8 items-center justify-center rounded-full text-xs font-bold transition-colors",
                      reached ? "bg-ink text-white shadow-sm" : "border-2 border-line bg-surface text-muted"
                    )}
                  >
                    {reached ? (i === stageIdx ? "●" : "✓") : i + 1}
                  </div>
                  <div
                    className={cx(
                      "mt-1.5 whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-wide",
                      reached ? "text-ink" : "text-muted/60"
                    )}
                  >
                    {meta.label}
                  </div>
                </div>
                {i < ORDER_STATUSES.length - 1 && (
                  <div className={cx("mx-2 mb-5 h-0.5 flex-1 rounded", i < stageIdx ? "bg-ink" : "bg-line")} />
                )}
              </div>
            );
          })}
        </div>
      </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* items */}
          <Card className="overflow-hidden">
            <div className="border-b border-line px-5 py-3.5 text-sm font-semibold text-ink">
              Order contents · from quote{" "}
              <Link href={`/quotes/${order.quoteId}`} className="text-brass hover:underline">
                {order.quote.ref}
              </Link>
            </div>
            <ul className="divide-y divide-line/70">
              {order.quote.items.map((item) => {
                if (isAccessoryConfig(item.config)) {
                  const cfg = item.config;
                  const acc = catalog.model(item.productId);
                  const img = cfg.image ?? (acc ? catalog.image(acc) : null);
                  return (
                    <li key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                      {img && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={img} alt={cfg.name} className="size-11 shrink-0 rounded-lg bg-[#0e0e10] object-contain p-1" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold text-ink">
                          {cfg.name}
                          <span className="ml-2 font-normal text-muted">{cfg.brand} · {cfg.sku}</span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted">{cfg.category}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums text-ink">
                          {usd(item.computation.unitPrice * item.qty)}
                        </div>
                        <div className="text-[11px] text-muted">
                          {item.qty} × {usd(item.computation.unitPrice)}
                        </div>
                      </div>
                    </li>
                  );
                }
                const product = getProduct(item.productId);
                const line = product ? getLine(item.lineId as string) : null;
                if (!product || !line) {
                  return (
                    <li key={item.id} className="flex items-center justify-between px-5 py-3.5">
                      <div>
                        <div className="text-[13.5px] font-semibold text-ink">Product no longer in catalog</div>
                        <div className="text-[11px] text-muted">{item.qty} × {usd(item.computation.unitPrice)}</div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums text-ink">{usd(item.computation.unitPrice * item.qty)}</div>
                    </li>
                  );
                }
                const desc = describeConfig(line, product, item.config);
                return (
                  <li key={item.id} className="flex items-center gap-4 px-5 py-3.5">
                    {desc.color && <Swatch color={desc.color} patternStyle={product.patternStyle} size={44} rounded={10} />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold text-ink">
                        {product.name}
                        <span className="ml-2 font-normal text-muted">
                          {desc.colorName} · {desc.opacityLabel}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">{desc.dims}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums text-ink">
                        {usd(item.computation.unitPrice * item.qty)}
                      </div>
                      <div className="text-[11px] text-muted">
                        {item.qty} × {usd(item.computation.unitPrice)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex justify-between border-t border-line bg-[#fafaf7] px-5 py-3.5 text-sm">
              <span className="font-semibold text-ink">Total · FOB</span>
              <span className="font-semibold tabular-nums text-ink">{usd(order.quote.total)}</span>
            </div>
          </Card>

          {/* timeline */}
          <Card className="px-5 py-5">
            <h3 className="text-sm font-semibold text-ink">Timeline</h3>
            <p className="mt-0.5 text-xs text-muted">
              Pushed in real time from the supplier system and logistics layer
            </p>
            <ol className="mt-4 space-y-0">
              {order.events.map((e, i) => (
                <li key={e.id} className="relative flex gap-4 pb-5 last:pb-0">
                  {i < order.events.length - 1 && (
                    <span className="absolute left-[7px] top-5 h-full w-0.5 bg-line" />
                  )}
                  <span
                    className={cx(
                      "relative mt-1 size-4 shrink-0 rounded-full border-2 border-white shadow",
                      i === 0 ? "bg-brass" : "bg-[#cfcabd]"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {e.status !== "note" && <StatusBadge status={e.status as (typeof ORDER_STATUSES)[number]} />}
                      <Badge tone="slate">{ACTOR_LABEL[e.actor]}</Badge>
                      <span className="text-[11px] text-muted">{fmtDateTime(e.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{e.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* fulfillment facts */}
        <div>
          <div className="sticky top-8 space-y-4">
            <Card className="px-5 py-5">
              <h3 className="text-sm font-semibold text-ink">Fulfillment</h3>
              <dl className="mt-3 space-y-3 text-[13px]">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Current stage</dt>
                  <dd className="mt-1">
                    <StatusBadge status={order.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Supplier order №</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">{order.supplierOrderNo ?? "Awaiting acknowledgement"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Tracking №</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">
                    {order.trackingNo ?? "Issued at dispatch"}
                  </dd>
                  {order.carrier && <dd className="text-xs text-muted">{order.carrier}</dd>}
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Estimated delivery</dt>
                  <dd className="mt-0.5 text-sm font-medium text-ink">
                    {order.etaDate ? fmtDate(order.etaDate) : "Confirmed at acknowledgement"}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card className="bg-[#fbf8f1] px-5 py-4">
              <p className="text-[12px] leading-relaxed text-ink-soft">
                <span className="font-semibold">How this works:</span> on submission the portal generated the
                bilingual supplier order file and queued it for delivery. The supplier returns an order number,
                production status, then a tracking number — all synced here and pushed to you until delivery.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
