import Link from "next/link";
import { notFound } from "next/navigation";
import { Swatch } from "@/components/renders";
import { BackLink, Badge, Card, cx, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { OrderPayment } from "@/components/OrderPayment";
import { RefundButton } from "@/components/RefundButton";
import { CancelOrderButton } from "@/components/CancelOrderButton";
import { PurchaseOrderMenu } from "@/components/PurchaseOrderMenu";
import { canAccessOwned, isAdmin, requireUserId, userClient } from "@/lib/auth/user";
import { admin } from "@/lib/supabase/admin";
import { getBankInfo, getConversationForRetailer, getLine, getMessages, getOrder, getOrderOwnerId, getOrderShipping, getProduct, getUnreadCount, getVariationItemModelMap, loadCatalog } from "@/lib/db";
import { QuoteChatLauncher } from "@/components/QuoteChatLauncher";
import { quoteItemsToRefs } from "@/lib/message-items";
import type { MotorRate } from "@/lib/shipping";
import { describeConfig } from "@/lib/describe";
import { isAccessoryConfig, isAdjustmentConfig } from "@/lib/types";
import { AccessoryVariations } from "@/components/AccessoryVariations";
import { OrderShippingRow } from "@/components/OrderShippingRow";
import { BRAND } from "@/lib/brand";
import { ACTOR_LABEL, fmtDate, fmtDateTime, ORDER_STATUS_META, usd } from "@/lib/format";
import { ORDER_STATUSES, ORDER_STATUSES_ACCESSORY, REFUNDABLE_STATUSES, type OrderStatus } from "@/lib/types";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId(`/orders/${id}`);
  const order = await getOrder(Number(id), await userClient());
  if (!order) notFound();

  if (!(await canAccessOwned(userId, await getOrderOwnerId(Number(id))))) notFound();

  const catalog = await loadCatalog(); // for accessory line images / names
  // Accessory-only orders run the collapsed 3-step pipeline; products run all 6.
  const stages: readonly OrderStatus[] = order.accessoryOnly ? ORDER_STATUSES_ACCESSORY : ORDER_STATUSES;
  const stageIdx = stages.indexOf(order.status);

  // Snapshotted shipping (mode + amount baked into order.amount at submit). Breakdown:
  // goods net = amount − shipping; subtotal − goods net = discount.
  const ship = await getOrderShipping(order.id);
  const orderTotal = order.amount ?? order.quote.total;
  const goodsNet = Math.round((orderTotal - ship.shipping) * 100) / 100;
  const discountAmt = Math.round((order.quote.total - goodsNet) * 100) / 100;
  const showBreakdown = order.discountPct > 0 || ship.mode === "ground";

  // Payment layer (retailer view; admin confirmation lives in the Supplier Console)
  const bankInfo = order.paymentMethod === "bank_transfer" ? await getBankInfo() : null;
  let proofUrl: string | null = null;
  if (order.paymentProofPath) {
    const { data } = await admin().storage.from("payment-proofs").createSignedUrl(order.paymentProofPath, 3600);
    proofUrl = data?.signedUrl ?? null;
  }
  const transferReported = order.events?.some((e) => e.note.includes("reported the bank transfer")) ?? false;
  const adminUser = await isAdmin(userId);

  // Refund: admin-only, full amount, pre-shipment (REFUNDABLE_STATUSES) on a paid order. A signed
  // URL exposes the supporting document on the refunded card.
  const canRefund =
    adminUser && order.paymentStatus === "paid" && (REFUNDABLE_STATUSES as readonly string[]).includes(order.status);
  // Cancel: unpaid orders only (retailer or admin) — releases stock + reopens the quote.
  const canCancel = order.status === "awaiting_payment";
  let refundDocUrls: string[] = [];
  if (order.refundDocPaths?.length) {
    const signed = await Promise.all(
      order.refundDocPaths.map((p) => admin().storage.from("payment-proofs").createSignedUrl(p, 3600))
    );
    refundDocUrls = signed.map((s) => s.data?.signedUrl).filter((u): u is string => !!u);
  }

  // Retailer-only "message us about this order" bubble — same widget as the quote page; admins
  // reply from the full inbox. Messages tag the order's source quote (so the admin sees a "Re: Q-…"
  // chip and the link works), while the bubble header reads "About PO-…".
  let chat: {
    conversationId: string | null;
    messages: Awaited<ReturnType<typeof getMessages>>;
    peerReadAt: string | null;
    unread: number;
  } | null = null;
  if (!adminUser) {
    const sb = await userClient();
    const conv = await getConversationForRetailer(userId, sb);
    const [messages, unread] = await Promise.all([
      conv ? getMessages(conv.id, sb) : Promise.resolve([]),
      getUnreadCount(userId, false, sb),
    ]);
    chat = { conversationId: conv?.id ?? null, messages, peerReadAt: conv?.adminLastReadAt ?? null, unread };
  }

  // --- Split the order by brand. Each brand is presented as its own purchase order with its own
  // total: goods + discount are split per line; the snapshot shipping is allocated across brands by
  // each brand's per-line ground cost, so the per-brand totals still sum exactly to what was charged.
  type LineItem = (typeof order.quote.items)[number];
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const brandOf = (it: LineItem) => (isAccessoryConfig(it.config) ? it.config.brand : BRAND.name);
  const brandGroups: { brand: string; items: LineItem[] }[] = [];
  for (const it of order.quote.items) {
    const g = brandGroups.find((x) => x.brand === brandOf(it));
    if (g) g.items.push(it);
    else brandGroups.push({ brand: brandOf(it), items: [it] });
  }
  const multiBrand = brandGroups.length > 1;

  // Per-line ground shipping cost — used both to weight the per-brand shipping split and to show a
  // breakdown under the Shipping line (each US-made / ground motor + any US-made variation sub-part).
  type ShipRow = { name: string; qty: number; unit: number; total: number };
  const itemModelMap = ship.mode === "ground" ? await getVariationItemModelMap() : {};
  const rateOf = (modelId?: string): MotorRate | undefined => {
    const m = modelId ? catalog.model(modelId) : undefined;
    return m ? { shipGround: m.shipGround, shipExpedite: m.shipExpedite, shipMode: m.shipMode } : undefined;
  };
  const unitShip = (rt?: MotorRate) =>
    rt?.shipMode === "ground" ? (ship.expedite ? rt.shipExpedite ?? 0 : rt.shipGround ?? 0) : 0;
  // Per-line shipping detail rows (only ground-mode parts are charged; FOB parts contribute nothing).
  const lineShipDetail = (it: LineItem): ShipRow[] => {
    if (ship.mode !== "ground" || !isAccessoryConfig(it.config)) return [];
    const rows: ShipRow[] = [];
    const push = (name: string, rt: MotorRate | undefined, units: number) => {
      if (rt?.shipMode !== "ground") return;
      const unit = unitShip(rt);
      rows.push({ name, qty: units, unit, total: r2(unit * units) });
    };
    push(catalog.model(it.productId)?.name ?? it.config.name, rateOf(it.productId), it.qty);
    for (const v of it.config.variations ?? []) push(v.itemLabel, rateOf(itemModelMap[v.itemId]), it.qty * (v.qty ?? 1));
    return rows;
  };
  const lineShipRaw = (it: LineItem) => lineShipDetail(it).reduce((s, r) => s + r.total, 0);
  // Distribute a dollar total across weights (largest-remainder on cents) — the parts sum exactly.
  const allocate = (total: number, weights: number[]): number[] => {
    const cents = Math.round(total * 100);
    const wsum = weights.reduce((a, b) => a + b, 0);
    const out = weights.map(() => 0);
    if (cents === 0) return out;
    const raw = wsum > 0 ? weights.map((w) => (w / wsum) * cents) : weights.map(() => cents / weights.length);
    raw.forEach((x, i) => (out[i] = Math.floor(x)));
    const ranked = raw.map((x, i) => ({ i, f: x - Math.floor(x) })).sort((a, b) => b.f - a.f);
    for (let k = 0, rem = cents - out.reduce((a, b) => a + b, 0); k < rem; k++) out[ranked[k].i]++;
    return out.map((c) => c / 100);
  };
  const brandSubtotals = brandGroups.map((g) => r2(g.items.reduce((s, it) => s + it.computation.unitPrice * it.qty, 0)));
  const brandDiscounts = allocate(discountAmt, brandSubtotals);
  const shipWeights = brandGroups.map((g) => g.items.reduce((s, it) => s + lineShipRaw(it), 0));
  const brandShippings = allocate(ship.shipping, shipWeights.some((w) => w > 0) ? shipWeights : brandSubtotals);
  const brandFooters = brandGroups.map((_, i) => {
    const goodsNet = r2(brandSubtotals[i] - brandDiscounts[i]);
    return { subtotal: brandSubtotals[i], discount: brandDiscounts[i], shipping: brandShippings[i], total: r2(goodsNet + brandShippings[i]) };
  });
  const brandShipDetail = brandGroups.map((g) => g.items.flatMap(lineShipDetail));
  const allShipDetail = order.quote.items.flatMap(lineShipDetail);

  const renderItem = (item: LineItem) => {
    if (isAdjustmentConfig(item.config)) {
      const cfg = item.config;
      const amount = item.computation.unitPrice;
      const isDiscount = amount < 0;
      return (
        <li key={item.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-ink">{cfg.label}</div>
            <div className="mt-0.5 text-[11px] text-muted">{cfg.note ?? (isDiscount ? "Discount" : "Charge")}</div>
          </div>
          <div className={`text-sm font-semibold tabular-nums ${isDiscount ? "text-emerald-600" : "text-ink"}`}>
            {isDiscount ? `−${usd(Math.abs(amount))}` : usd(amount)}
          </div>
        </li>
      );
    }
    if (isAccessoryConfig(item.config)) {
      const cfg = item.config;
      const acc = catalog.model(item.productId);
      const img = cfg.image ?? (acc ? catalog.image(acc) : null);
      // Link the motor name back to the Accessory browser with its row preselected (?sel),
      // landing on the right brand + category so the row is in the visible list.
      const accCat = acc ? catalog.category(acc.categoryId) : null;
      const accHref = acc
        ? `/catalog/accessories?${new URLSearchParams({
            ...(accCat?.brandId ? { brand: accCat.brandId } : {}),
            cat: acc.categoryId,
            sel: acc.id,
          }).toString()}`
        : null;
      return (
        <li key={item.id} className="flex items-start gap-4 px-5 py-3.5">
          {img && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={img} alt={cfg.name} className="size-11 shrink-0 rounded-lg bg-[#0e0e10] object-contain p-1" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-ink">
              {accHref ? (
                <Link href={accHref} className="hover:text-brass hover:underline">
                  {cfg.name}
                </Link>
              ) : (
                cfg.name
              )}
              <span className="ml-2 font-normal text-muted">{cfg.sku}</span>
              {cfg.airFreight && (
                <span className="ml-2 inline-block rounded-full border border-[#e0cfa8] bg-brass-soft px-2 py-0.5 text-[10px] font-semibold text-[#8a6a39]">
                  ✈ Air freight
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">{[cfg.brand, cfg.category].filter(Boolean).join(" · ")}</div>
            <AccessoryVariations cfg={cfg} motorQty={item.qty} />
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold tabular-nums text-ink">{usd(item.computation.unitPrice * item.qty)}</div>
            <div className="text-[11px] text-muted">{item.qty} × {usd(item.computation.unitPrice)}</div>
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
            <span className="ml-2 font-normal text-muted">{desc.colorName} · {desc.opacityLabel}</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">{desc.dims}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-ink">{usd(item.computation.unitPrice * item.qty)}</div>
          <div className="text-[11px] text-muted">{item.qty} × {usd(item.computation.unitPrice)}</div>
        </div>
      </li>
    );
  };

  // Right-hand amount text for a shipping line (FOB / charged / free).
  const shipValueText = (amount: number) =>
    ship.mode !== "ground" ? "FOB — you arrange" : amount > 0 ? `+${usd(amount)}` : "Free";

  // Per-brand totals footer (mirrors the order-level footer, but with this brand's split figures).
  const brandFooter = (
    f: { subtotal: number; discount: number; shipping: number; total: number },
    shipLines: ShipRow[]
  ) => (
    <div className="space-y-1.5 border-t border-line bg-[#fafaf7] px-5 py-3.5 text-sm">
      <div className="flex justify-between text-muted">
        <span>Subtotal{ship.mode !== "ground" ? " · FOB" : ""}</span>
        <span className="tabular-nums">{usd(f.subtotal)}</span>
      </div>
      {f.discount > 0 && (
        <div className="flex justify-between text-brass">
          <span>Discount ({order.discountPct}%)</span>
          <span className="tabular-nums">−{usd(f.discount)}</span>
        </div>
      )}
      <OrderShippingRow
        ground={ship.mode === "ground"}
        expedite={ship.expedite}
        valueText={shipValueText(f.shipping)}
        lines={shipLines}
      />
      <div className="flex justify-between pt-0.5 font-semibold text-ink">
        <span>Total{ship.mode !== "ground" ? " · FOB" : ""}</span>
        <span className="tabular-nums">{usd(f.total)}</span>
      </div>
    </div>
  );

  return (
    <div>
      <BackLink href={adminUser ? "/supplier" : "/orders"}>{adminUser ? "Supplier Console" : "All orders"}</BackLink>
      <PageHeader
        eyebrow={`Order · placed ${fmtDate(order.createdAt)}`}
        title={order.ref}
        description={order.quote.projectName ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            {canCancel && <CancelOrderButton orderId={order.id} />}
            {canRefund && <RefundButton orderId={order.id} amountLabel={usd(order.amount ?? order.quote.total)} />}
            {/* Invoice — same customer-facing document as the quote page, visible to everyone who can
                view the order (owner retailer or admin); /invoices gates its own access. */}
            <LinkButton href={`/invoices/${order.quoteId}`} variant="secondary" target="_blank">
              Invoice
            </LinkButton>
            {/* Purchase order file is a supplier/back-office artifact — admin-only. */}
            {adminUser && <PurchaseOrderMenu orderId={order.id} brands={brandGroups.map((g) => g.brand)} />}
          </div>
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
              This order was cancelled before payment. The quote has been reopened for editing —{" "}
              <Link href={`/quotes/${order.quoteId}`} className="font-medium text-brass hover:underline">
                edit quote {order.quote.ref} →
              </Link>
            </p>
          </Card>
        ) : order.status === "refunded" ? (
          <Card className="border-line bg-[#faf9f5] px-5 py-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Order refunded</h3>
              <StatusBadge status="refunded" />
            </div>
            <p className="mt-2 text-[13px] text-ink-soft">
              A full refund of <span className="font-semibold text-ink">{usd(order.amount ?? order.quote.total)}</span>
              {" "}was issued{order.refundedAt ? ` on ${fmtDate(order.refundedAt)}` : ""}. The order is now closed.
            </p>
            {order.refundReason && (
              <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-[12.5px] text-ink-soft">
                <span className="font-semibold text-ink">Reason: </span>
                {order.refundReason}
              </p>
            )}
            {refundDocUrls.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {refundDocUrls.map((u, i) => (
                  <a
                    key={u}
                    href={u}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brass hover:underline"
                  >
                    📎 View supporting document{refundDocUrls.length > 1 ? ` ${i + 1}` : ""}
                  </a>
                ))}
              </div>
            )}
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
          {stages.map((s, i) => {
            const reached = i <= stageIdx;
            const meta = ORDER_STATUS_META[s];
            return (
              <div key={s} className={cx("flex items-center", i < stages.length - 1 && "flex-1")}>
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
                {i < stages.length - 1 && (
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
          {/* items — one purchase order per brand (each with its own total) */}
          {multiBrand ? (
            <div className="space-y-5">
              <div className="text-xs text-muted">
                Order contents · from quote{" "}
                <Link href={`/quotes/${order.quoteId}`} className="font-medium text-brass hover:underline">
                  {order.quote.ref}
                </Link>{" "}
                · split into {brandGroups.length} orders by brand
              </div>
              {brandGroups.map((g, gi) => (
                <Card key={g.brand} className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-ink">{g.brand}</span>
                      <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                        · {g.items.length} {g.items.length === 1 ? "item" : "items"}
                      </span>
                    </div>
                  </div>
                  <ul className="divide-y divide-line/70">{g.items.map(renderItem)}</ul>
                  {brandFooter(brandFooters[gi], brandShipDetail[gi])}
                </Card>
              ))}
            </div>
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <div className="text-sm font-semibold text-ink">
                  Order contents · from quote{" "}
                  <Link href={`/quotes/${order.quoteId}`} className="text-brass hover:underline">
                    {order.quote.ref}
                  </Link>
                </div>
              </div>
              <ul className="divide-y divide-line/70">{order.quote.items.map(renderItem)}</ul>
              {showBreakdown ? (
                <div className="space-y-1.5 border-t border-line bg-[#fafaf7] px-5 py-3.5 text-sm">
                  <div className="flex justify-between text-muted">
                    <span>Subtotal · FOB</span>
                    <span className="tabular-nums">{usd(order.quote.total)}</span>
                  </div>
                  {order.discountPct > 0 && (
                    <div className="flex justify-between text-brass">
                      <span>Discount ({order.discountPct}%)</span>
                      <span className="tabular-nums">−{usd(discountAmt)}</span>
                    </div>
                  )}
                  <OrderShippingRow
                    ground={ship.mode === "ground"}
                    expedite={ship.expedite}
                    valueText={shipValueText(ship.shipping)}
                    lines={allShipDetail}
                  />
                  <div className="flex justify-between pt-0.5 font-semibold text-ink">
                    <span>Total{ship.mode !== "ground" ? " · FOB" : ""}</span>
                    <span className="tabular-nums">{usd(orderTotal)}</span>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between border-t border-line bg-[#fafaf7] px-5 py-3.5 text-sm">
                  <span className="font-semibold text-ink">Total · FOB</span>
                  <span className="font-semibold tabular-nums text-ink">{usd(orderTotal)}</span>
                </div>
              )}
            </Card>
          )}

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
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">Purchase order №</dt>
                  <dd className="mt-0.5 font-mono text-sm text-ink">{order.supplierOrderNo ?? "Awaiting acknowledgement"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Tracking {order.trackingNos && order.trackingNos.length > 1 ? "№s" : "№"}
                  </dt>
                  {order.trackingNos && order.trackingNos.length > 0 ? (
                    <dd className="mt-0.5 space-y-0.5">
                      {order.trackingNos.map((t) => (
                        <div key={t} className="font-mono text-sm text-ink">{t}</div>
                      ))}
                    </dd>
                  ) : (
                    <dd className="mt-0.5 font-mono text-sm text-ink">{order.trackingNo ?? "Issued at dispatch"}</dd>
                  )}
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
                <span className="font-semibold">How this works:</span>{" "}
                {order.accessoryOnly ? (
                  <>
                    on payment the portal generated the bilingual purchase order file and confirmed the order
                    automatically — a purchase order number and ETA are issued. The supplier then ships and
                    records the tracking number(s), synced here and pushed to you.
                  </>
                ) : (
                  <>
                    on submission the portal generated the bilingual purchase order file and queued it for
                    delivery. The supplier returns an order number, production status, then a tracking number —
                    all synced here and pushed to you until delivery.
                  </>
                )}
              </p>
            </Card>
          </div>
        </div>
      </div>

      {chat && (
        <QuoteChatLauncher
          quote={{ id: order.quoteId, ref: order.quote.ref }}
          aboutLabel={order.ref}
          referenceItems={quoteItemsToRefs(order.quote.items, catalog)}
          conversationId={chat.conversationId}
          initialMessages={chat.messages}
          initialPeerReadAt={chat.peerReadAt}
          initialUnread={chat.unread}
        />
      )}
    </div>
  );
}
