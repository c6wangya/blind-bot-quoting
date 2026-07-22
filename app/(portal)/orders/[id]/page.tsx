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
import { getBankInfo, getConversationForRetailer, getInventoryMap, getLine, getMessages, getOrder, getOrderOwnerId, getOrderShipping, getProduct, getProductVariationMap, getEffectivePrices, getUnreadCount, getVariationItemModelMap, getVariations, loadCatalog } from "@/lib/db";
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

  // --- Refunds (partial or full) + exchanges. A line is returnable if it's real goods — not an
  // adjustment, not itself an exchange replacement (those were shipped in place of returned goods,
  // so they're shown for reference in the dialog but can't be returned again).
  const isReturnable = (it: (typeof order.quote.items)[number]) =>
    !isAdjustmentConfig(it.config) && !(isAccessoryConfig(it.config) && it.config.exchange);
  const refunds = order.refunds ?? [];
  const refundedTotal = Math.round(refunds.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  // Units already refunded per line, across every refund record — drives "Returned ×N" + remaining.
  const returnedQtyByItem = new Map<number, number>();
  for (const r of refunds) for (const li of r.lineItems) returnedQtyByItem.set(li.itemId, (returnedQtyByItem.get(li.itemId) ?? 0) + li.qty);

  // Refund: admin-only, on a paid or partially-refunded order still in the fulfilment window, with
  // at least one returnable unit left.
  const hasRefundableLeft = order.quote.items.some(
    (it) => isReturnable(it) && it.qty - (returnedQtyByItem.get(it.id) ?? 0) > 0
  );
  const canRefund =
    adminUser &&
    (order.paymentStatus === "paid" || order.paymentStatus === "partially_refunded") &&
    (REFUNDABLE_STATUSES as readonly string[]).includes(order.status) &&
    hasRefundableLeft;
  const preShipment = (["submitted", "acknowledged", "in_production"] as readonly string[]).includes(order.status);
  // Cancel: unpaid orders only (retailer or admin) — releases stock + reopens the quote.
  const canCancel = order.status === "awaiting_payment";

  // Signed URLs for every refund's supporting documents (private bucket), plus legacy single-refund
  // docs from before order_refunds existed (old fully-refunded orders).
  const legacyDocs = order.refundDocPaths ?? [];
  const allDocPaths = [...refunds.flatMap((r) => r.docPaths), ...legacyDocs];
  const signed = allDocPaths.length
    ? await Promise.all(allDocPaths.map((p) => admin().storage.from("payment-proofs").createSignedUrl(p, 3600)))
    : [];
  const docUrlByPath = new Map<string, string>();
  allDocPaths.forEach((p, i) => {
    const u = signed[i]?.data?.signedUrl;
    if (u) docUrlByPath.set(p, u);
  });

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

  // "Exchange" (a $0 replacement line) and "Returned ×N" (units refunded) chips, shown on lines.
  const itemBadges = (item: LineItem) => {
    const returnedQty = returnedQtyByItem.get(item.id) ?? 0;
    const isExchange = isAccessoryConfig(item.config) && item.config.exchange;
    if (!isExchange && returnedQty === 0) return null;
    return (
      <>
        {isExchange && (
          <span className="ml-2 inline-block rounded-full border border-[#e0cfa8] bg-brass-soft px-2 py-0.5 text-[10px] font-semibold text-[#8a6a39]">
            Exchange
          </span>
        )}
        {returnedQty > 0 && (
          <span className="ml-2 inline-block rounded-full border border-line bg-[#f1efe9] px-2 py-0.5 text-[10px] font-semibold text-muted">
            Returned ×{returnedQty}
          </span>
        )}
      </>
    );
  };

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
              {itemBadges(item)}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">{[cfg.brand, cfg.category].filter(Boolean).join(" · ")}</div>
            <AccessoryVariations cfg={cfg} motorQty={item.qty} />
          </div>
          <div className="text-right">
            {cfg.exchange ? (
              <>
                {/* Real value struck through — it's covered by the returned goods ("多退少补"). */}
                <div className="text-sm font-semibold tabular-nums text-muted line-through">
                  {usd((cfg.exchangeValue ?? 0) * item.qty)}
                </div>
                <div className="text-[11px] font-medium text-brass">No charge · exchange</div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold tabular-nums text-ink">{usd(item.computation.unitPrice * item.qty)}</div>
                <div className="text-[11px] text-muted">{item.qty} × {usd(item.computation.unitPrice)}</div>
              </>
            )}
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
            {itemBadges(item)}
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

  // Refund adjustment rows for a totals footer (Shopify-style): the Total above is what was
  // originally charged; break out the cash refunded and the net the customer is left paying.
  const netTotal = Math.max(0, r2(orderTotal - refundedTotal));
  const refundFooterRows =
    refundedTotal > 0 ? (
      <>
        <div className="flex justify-between text-brass">
          <span>Refunded</span>
          <span className="tabular-nums">−{usd(refundedTotal)}</span>
        </div>
        <div className="flex justify-between border-t border-line pt-1.5 font-semibold text-ink">
          <span>Net total{ship.mode !== "ground" ? " · FOB" : ""}</span>
          <span className="tabular-nums">{usd(netTotal)}</span>
        </div>
      </>
    ) : null;

  // --- Refund dialog inputs (admin only). Returnable lines carry a display name + how many units
  // remain refundable; the picker exposes the orderable accessory catalog (scoped to the order's
  // accessory brand, to keep the one-brand-per-quote invariant) for exchanges.
  const lineLabel = (it: LineItem): { name: string; sub: string } => {
    if (isAdjustmentConfig(it.config)) return { name: it.config.label, sub: "" };
    if (isAccessoryConfig(it.config)) return { name: it.config.name, sub: [it.config.brand, it.config.category].filter(Boolean).join(" · ") };
    const product = getProduct(it.productId);
    const line = product ? getLine(it.lineId as string) : null;
    if (product && line) {
      const d = describeConfig(line, product, it.config);
      return { name: product.name, sub: [d.colorName, d.opacityLabel].filter(Boolean).join(" · ") };
    }
    return { name: "Item", sub: "" };
  };
  // Every non-adjustment line is shown in the dialog. Exchange replacements are flagged so the
  // dialog renders them as read-only reference rows (shipped in place of a return; not returnable);
  // their `unitPrice` carries the real worth (exchangeValue) purely for display.
  const returnableLines = canRefund
    ? order.quote.items
        .filter((it) => !isAdjustmentConfig(it.config))
        .map((it) => {
          const base = lineLabel(it);
          const exchange = isAccessoryConfig(it.config) && it.config.exchange ? it.config : null;
          return {
            itemId: it.id,
            name: base.name,
            sub: base.sub,
            unitPrice: exchange ? exchange.exchangeValue ?? 0 : it.computation.unitPrice,
            orderedQty: it.qty,
            refundedQty: returnedQtyByItem.get(it.id) ?? 0,
            exchange: !!exchange,
          };
        })
    : [];

  let pickerData: {
    models: Parameters<typeof RefundButton>[0]["picker"]["models"];
  } = { models: [] };
  if (canRefund) {
    const ownerId = order.quote.ownerId ?? "";
    // Products are sold standalone, but each motor (main product) still carries a list of compatible
    // accessories (crowns, drives, remotes, brackets…) surfaced in a second tab of its picker detail.
    // Those relationships come from variation_product_items (motor → variation items), and every
    // variation item is backed by a real orderable source model we add on its own.
    const [inventory, effPrices, variationMap, rawVariations, itemModelMap] = await Promise.all([
      getInventoryMap(),
      getEffectivePrices(ownerId),
      getProductVariationMap(),
      getVariations(),
      getVariationItemModelMap(),
    ]);
    const itemById = new Map(rawVariations.flatMap((v) => v.items.map((it) => [it.id, it] as const)));
    const existingBrand = order.quote.items
      .map((it) => (isAccessoryConfig(it.config) && !it.config.exchange ? it.config.brand : null))
      .find((b): b is string => !!b);
    const brandNameOf = (catId: string) =>
      catalog.brands.find((b) => b.id === catalog.category(catId)?.brandId)?.name ?? catalog.brand.name;
    const inBrand = (catId: string | undefined) => !!catId && (!existingBrand || brandNameOf(catId) === existingBrand);

    // A motor's compatible accessories: each linked variation item → its orderable source model.
    const accessoriesOf = (motorId: string) => {
      const seen = new Set<string>();
      const out: {
        productId: string;
        name: string;
        sku: string;
        image: string | null;
        price: number | null;
        stock: number | null;
        moq: number;
      }[] = [];
      for (const itemId of variationMap[motorId] ?? []) {
        const srcId = itemModelMap[itemId];
        if (!srcId || seen.has(srcId)) continue;
        const src = catalog.model(srcId);
        const cat = src ? catalog.category(src.categoryId) : undefined;
        if (!src || !cat?.orderable || !inBrand(src.categoryId)) continue;
        seen.add(srcId);
        const item = itemById.get(itemId);
        out.push({
          productId: src.id,
          name: src.name,
          sku: src.sku,
          image: catalog.image(src) || item?.image || null,
          price: effPrices[src.id] ?? src.price ?? null,
          stock: src.id in inventory ? inventory[src.id] : null,
          moq: src.moq ?? 0,
        });
      }
      return out;
    };

    // Top-level list is main products (motors); each carries its accessories for the second tab.
    const models = catalog.categories
      .filter((c) => c.orderable && inBrand(c.id) && /motor/i.test(c.name))
      .flatMap((c) => catalog.modelsIn(c.id).map((m) => ({ m, catName: c.name })))
      .map(({ m, catName }) => ({
        id: m.id,
        name: m.name,
        sku: m.sku,
        image: catalog.image(m) || null,
        price: effPrices[m.id] ?? m.price ?? null,
        stock: m.id in inventory ? inventory[m.id] : null,
        moq: m.moq ?? 0,
        categoryName: catName,
        accessories: accessoriesOf(m.id),
      }));
    pickerData = { models };
  }

  // Signed doc URLs grouped per refund record, for the Refunds card.
  const refundViews = refunds.map((r) => ({
    refund: r,
    docUrls: r.docPaths.map((p) => docUrlByPath.get(p)).filter((u): u is string => !!u),
  }));
  const legacyDocUrls = legacyDocs.map((p) => docUrlByPath.get(p)).filter((u): u is string => !!u);
  const paidLabel = usd(order.amount ?? order.quote.total);
  const netLabel = usd(Math.max(0, Math.round(((order.amount ?? order.quote.total) - refundedTotal) * 100) / 100));

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
            {canRefund && (
              <RefundButton
                orderId={order.id}
                paidLabel={paidLabel}
                alreadyRefunded={refundedTotal}
                netOutstanding={Math.max(0, Math.round(((order.amount ?? order.quote.total) - refundedTotal) * 100) / 100)}
                lines={returnableLines}
                preShipment={preShipment}
                picker={pickerData}
              />
            )}
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
        ) : (
          <OrderPayment
            orderId={order.id}
            method={order.paymentMethod}
            paymentStatus={order.paymentStatus}
            amountLabel={paidLabel}
            bankInfo={bankInfo}
            proofUrl={proofUrl}
            transferReported={transferReported}
            refundedLabel={refundedTotal > 0 ? usd(refundedTotal) : undefined}
            netLabel={refundedTotal > 0 ? netLabel : undefined}
          >
            {/* Refunds — one entry per refund event (partial or full), newest first. Covers returned
                lines, any exchange replacements, the net cash, reason + documents. Merged into the
                Payment card (the status pill above already reflects refunded / partially refunded). */}
            {(refundViews.length > 0 || legacyDocUrls.length > 0 || (order.status === "refunded" && order.refundReason)) && (
              <div className="mt-4 border-t border-line pt-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {order.status === "refunded" ? "Refund" : "Refunds"}
                </h4>
                <ul className="mt-2 space-y-3">
                  {refundViews.map(({ refund: r, docUrls }) => (
                    <li key={r.id} className="rounded-xl border border-line bg-surface px-4 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-semibold text-ink">
                          {usd(r.amount)} refunded
                          {r.replacementItems.length > 0 && <span className="font-normal text-muted"> · exchange</span>}
                        </span>
                        <span className="text-[11.5px] text-muted">{fmtDate(r.createdAt)}</span>
                      </div>
                      <div className="mt-1.5 space-y-0.5 text-[12px] text-ink-soft">
                        {r.lineItems.map((li, i) => (
                          <div key={`r-${i}`}>Returned ×{li.qty} · {usd(li.amount)}</div>
                        ))}
                        {r.replacementItems.map((rep, i) => (
                          <div key={`x-${i}`} className="text-brass">Exchanged for {rep.name} ×{rep.qty} · value {usd(rep.value)}</div>
                        ))}
                        {r.restocked && <div className="text-muted">Reserved stock released</div>}
                      </div>
                      {r.reason && (
                        <p className="mt-1.5 text-[12px] text-ink-soft">
                          <span className="font-semibold text-ink">Reason: </span>{r.reason}
                        </p>
                      )}
                      {docUrls.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-1">
                          {docUrls.map((u, i) => (
                            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brass hover:underline">
                              📎 Supporting document{docUrls.length > 1 ? ` ${i + 1}` : ""}
                            </a>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                  {/* Legacy fully-refunded orders (pre-order_refunds): show the single reason + docs. */}
                  {refundViews.length === 0 && (legacyDocUrls.length > 0 || order.refundReason) && (
                    <li className="rounded-xl border border-line bg-surface px-4 py-3">
                      {order.refundedAt && (
                        <p className="text-[12px] font-semibold text-ink">
                          Full refund{order.amount != null ? ` · ${usd(order.amount)}` : ""} on {fmtDate(order.refundedAt)}
                        </p>
                      )}
                      {order.refundReason && (
                        <p className="mt-1 text-[12px] text-ink-soft"><span className="font-semibold text-ink">Reason: </span>{order.refundReason}</p>
                      )}
                      <div className="mt-1.5 flex flex-col gap-1">
                        {legacyDocUrls.map((u, i) => (
                          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-brass hover:underline">
                            📎 Supporting document{legacyDocUrls.length > 1 ? ` ${i + 1}` : ""}
                          </a>
                        ))}
                      </div>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </OrderPayment>
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
              {refundFooterRows && (
                <Card className="space-y-1.5 px-5 py-3.5 text-sm">
                  <div className="flex justify-between text-muted">
                    <span>Order total</span>
                    <span className="tabular-nums">{usd(orderTotal)}</span>
                  </div>
                  {refundFooterRows}
                </Card>
              )}
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
              {showBreakdown || refundFooterRows ? (
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
                  {refundFooterRows}
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
              {order.events.map((e, i) => {
                // Refund/exchange notes get a dedicated badge (from the note's leading phrase)
                // instead of the generic "System" actor tag.
                const refundLabel = e.status === "note"
                  ? e.note.startsWith("Partial refund")
                    ? "Partial refund"
                    : /^Order (fully )?refunded/.test(e.note)
                      ? "Refund"
                      : null
                  : null;
                return (
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
                      {refundLabel ? (
                        <Badge tone="amber">{refundLabel}</Badge>
                      ) : (
                        <Badge tone="slate">{ACTOR_LABEL[e.actor]}</Badge>
                      )}
                      <span className="text-[11px] text-muted">{fmtDateTime(e.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{e.note}</p>
                  </div>
                </li>
                );
              })}
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
