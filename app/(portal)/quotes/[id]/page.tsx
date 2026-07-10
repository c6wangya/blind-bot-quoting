import Link from "next/link";
import { MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import { AddAdjustmentButton, DeleteDraftButton, LinePriceEditor, PendingPaymentCard, RemoveItemButton, SubmitPreOrderButton } from "@/components/QuoteActions";
import { QuoteDetailsDrawer } from "@/components/QuoteDetailsDrawer";
import { ShippingSummaryRow } from "@/components/ShippingSummaryRow";
import { ShippingRecalcProvider } from "@/components/ShippingRecalcContext";
import { AdminExpediteBox } from "@/components/AdminExpediteBox";
import { ExpediteStatusPoller } from "@/components/ExpediteStatusPoller";
import { AccessoryLineEditor, type EditorVariation } from "@/components/AccessoryLineEditor";
import { AccessoryVariations } from "@/components/AccessoryVariations";
import { LineQtyEditor } from "@/components/LineQtyEditor";
import { Swatch } from "@/components/renders";
import { BackLink, Badge, Card, EmptyState, LinkButton } from "@/components/ui";
import { QuoteChatLauncher } from "@/components/QuoteChatLauncher";
import { quoteItemsToRefs } from "@/lib/message-items";
import { isAdmin, requireUserId, userClient } from "@/lib/auth/user";
import {
  getConversationForRetailer,
  getLine,
  getMessages,
  getOrderRefByQuote,
  getProduct,
  getQuote,
  getQuoteOwnerId,
  getQuoteExpedite,
  getQuoteExpediteState,
  expediteSignature,
  getInventoryMap,
  listAddresses,
  getRetailerDiscount,
  getShippingWaivers,
  getUnreadCount,
  getVariationItemModelMap,
  getVariationsForModel,
  getExclusionGroupsMap,
  type VariationType,
  loadCatalog,
} from "@/lib/db";
import { computeShipping, type MotorRate } from "@/lib/shipping";
import { canInvoiceQuote } from "@/lib/invoice";
import { describeConfig } from "@/lib/describe";
import { fmtDate, usd } from "@/lib/format";
import { isAccessoryConfig, isAdjustmentConfig } from "@/lib/types";

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </div>
  );
}

function Ref({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="text-[12.5px] text-muted">
      {label}: <span className="text-ink-soft">{value || "—"}</span>
    </div>
  );
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  const [userId, sb] = await Promise.all([requireUserId(`/quotes/${id}`), userClient()]);

  // Quote + ownership + viewer role resolve together; the guards below 404 before we render.
  const [quote, ownerId, viewerIsAdmin] = await Promise.all([
    getQuote(numId, sb),
    getQuoteOwnerId(numId),
    isAdmin(userId),
  ]);
  if (!quote) notFound();
  // Inline of canAccessOwned() so we reuse viewerIsAdmin instead of a second profile lookup.
  const canAccess =
    ownerId === undefined ? false : ownerId === null || ownerId === userId || viewerIsAdmin;
  if (!canAccess) notFound();

  // Everything below is independent of one another — fan out in a single batch instead of a
  // sequential waterfall (each await was its own Supabase round-trip; this collapses them to one
  // wave, so a qty change's router.refresh() pays the max latency, not the sum).
  const [discountPct, order, catalog, expedite, waivers, itemModelMap, inventory, expediteState, conv] =
    await Promise.all([
      getRetailerDiscount(ownerId),
      // Always look up the quote's live order: a draft can carry an unpaid pre-order
      // (awaiting_payment) — the quote stays "draft" until payment lands, but the page locks
      // editing and shows a "go to payment" card; a converted quote's order powers "View order".
      getOrderRefByQuote(quote.id, sb),
      loadCatalog(), // for accessory line images / names
      // Shipping: each motor's mode (FOB/Ground) is set per-model by an admin; the customer only
      // controls expedite. Priced per line, live against the net goods total (server is source of truth).
      getQuoteExpedite(quote.id, sb),
      getShippingWaivers(ownerId),
      getVariationItemModelMap(),
      // Live stock — for the in-quote qty editors (motors + their per-motor sub-parts).
      getInventoryMap(),
      getQuoteExpediteState(quote.id, sb),
      // Retailer-only "message us about this quote" bubble; admins reply from the full inbox.
      viewerIsAdmin ? Promise.resolve(null) : getConversationForRetailer(userId, sb),
    ]);

  // An unpaid pre-order leaves the quote on "draft" but locks it: stock is reserved + the amount is
  // snapshotted, so the line items can't change until it's paid (→ converted) or cancelled (→ back
  // to a plain editable draft). `editable` gates every in-quote edit; `pendingOrder` drives the
  // "awaiting payment" card.
  const pendingOrder = order?.status === "awaiting_payment" ? order : null;
  const editable = quote.status === "draft" && !pendingOrder;

  // Order-level discount: the retailer's standing % off the subtotal (0 = none).
  const netTotal = Math.round(quote.total * (1 - discountPct / 100) * 100) / 100;
  const discountAmt = Math.round((quote.total - netTotal) * 100) / 100;

  const variationStock: Record<string, number | null> = {};
  for (const [itemId, modelId] of Object.entries(itemModelMap)) {
    variationStock[itemId] = modelId in inventory ? inventory[modelId] : null;
  }

  // Every add-on part each accessory motor offers — powers the in-quote "+ Add accessory" picker so
  // a retailer can add a part to a motor already on the line (deduped by model; usually 1–2 motors).
  const accModelIds = [
    ...new Set(quote.items.filter((i) => isAccessoryConfig(i.config)).map((i) => i.productId)),
  ];
  const [partsByModelEntries, exclusionMap] = await Promise.all([
    Promise.all(accModelIds.map(async (mid) => [mid, await getVariationsForModel(mid)] as const)),
    accModelIds.length ? getExclusionGroupsMap() : Promise.resolve({} as Record<string, string[][]>),
  ]);
  const partsByModel: Record<string, VariationType[]> = Object.fromEntries(partsByModelEntries);
  // variation item_id → its source model's shipping rate/mode (for sub-parts like brackets).
  const itemRates: Record<string, MotorRate> = {};
  for (const [itemId, modelId] of Object.entries(itemModelMap)) {
    const m = catalog.model(modelId);
    if (m) itemRates[itemId] = { shipGround: m.shipGround, shipExpedite: m.shipExpedite, shipMode: m.shipMode };
  }
  const ship = computeShipping(quote.items, catalog, itemRates, expedite, netTotal, waivers);
  // Admin-priced expedite (migration 0026): the customer requests it, an admin sets one flat fee.
  // The system reference (old per-line accumulation, always-charged → rawAmount) is shown to the
  // admin as a suggestion; the quoted fee folds into the total once set.
  const expediteRef = computeShipping(quote.items, catalog, itemRates, true, netTotal, {
    ground: false,
    expedite: false,
  }).rawAmount;
  // Stale = the quoted fee no longer matches the current contents (fingerprint mismatch). The fee is
  // withheld from the total and re-confirmation is required; reverting the change makes it match →
  // restored. A null sig (fee quoted before fingerprints existed) can't be vouched for → treated as
  // stale, so a re-quote repopulates it and normal behaviour resumes.
  const expediteStale =
    expediteState.status === "quoted" && expediteState.sig !== expediteSignature(quote.items);
  const expediteFee = expediteState.status === "quoted" && !expediteStale ? expediteState.fee ?? 0 : 0;
  const grandTotal = Math.max(0, Math.round((netTotal + ship.amount + expediteFee) * 100) / 100);
  // Per-item shipping breakdown (each US-made / ground motor + any US-made variation sub-part).
  const unitOf = (r: MotorRate) => (expedite ? r.shipExpedite ?? 0 : r.shipGround ?? 0);
  const shipLineDetail = ship.hasGround
    ? quote.items.flatMap((it) => {
        if (!isAccessoryConfig(it.config)) return [];
        const rows: { name: string; qty: number; unit: number; total: number }[] = [];
        const push = (name: string, r?: MotorRate, units = it.qty) => {
          if (r?.shipMode !== "ground") return;
          const unit = unitOf(r);
          rows.push({ name, qty: units, unit, total: Math.round(unit * units * 100) / 100 });
        };
        const m = catalog.model(it.productId);
        push(m?.name ?? it.config.name, m);
        // Sub-parts ship per motor unit, so the shippable count is motorQty × per-motor qty.
        for (const v of it.config.variations ?? []) push(v.itemLabel, itemRates[v.itemId], it.qty * (v.qty ?? 1));
        return rows;
      })
    : [];

  // Chat payload: conv was fetched above; its messages + unread count are the only remaining
  // dependent reads, run in parallel (admins use the full inbox, so the launcher is retailer-only).
  let chatMessages: Awaited<ReturnType<typeof getMessages>> = [];
  let chatUnread = 0;
  if (!viewerIsAdmin) {
    [chatMessages, chatUnread] = await Promise.all([
      conv ? getMessages(conv.id, sb) : Promise.resolve([]),
      getUnreadCount(userId, false, sb),
    ]);
  }
  const chat = viewerIsAdmin
    ? null
    : {
        conversationId: conv?.id ?? null,
        messages: chatMessages,
        peerReadAt: conv?.adminLastReadAt ?? null,
        unread: chatUnread,
      };

  // Accessory-only quotes get the checkout-form pay flow (details + address book); products don't.
  // Ad-hoc adjustment lines are money-only — ignore them when judging "all accessory".
  const goodsItems = quote.items.filter((it) => !isAdjustmentConfig(it.config));
  const allAccessory = goodsItems.length > 0 && goodsItems.every((it) => isAccessoryConfig(it.config));
  const details = {
    quoteType: quote.quoteType,
    quoteName: quote.quoteName,
    projectName: quote.projectName,
    customerName: quote.customerName,
    customerPhone: quote.customerPhone,
    customerEmail: quote.customerEmail,
    shipAddress1: quote.shipAddress1,
    shipAddress2: quote.shipAddress2,
    shipCity: quote.shipCity,
    shipState: quote.shipState,
    shipZip: quote.shipZip,
    po: quote.po,
    sidemark: quote.sidemark,
  };
  const shipLines = [
    quote.shipAddress1,
    quote.shipAddress2,
    [quote.shipCity, quote.shipState, quote.shipZip].filter(Boolean).join(", ") || null,
  ].filter(Boolean) as string[];

  // Mark which saved address this quote's details came from (match on the identifying fields) so the
  // card can label it, e.g. "nanjing". Only when the quote actually carries customer/ship info.
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const savedAddresses = ownerId ? await listAddresses(ownerId) : [];
  const usedAddressLabel =
    (quote.customerName || quote.shipAddress1)
      ? savedAddresses.find(
          (a) =>
            norm(a.customerName) === norm(quote.customerName) &&
            norm(a.shipAddress1) === norm(quote.shipAddress1) &&
            norm(a.shipCity) === norm(quote.shipCity) &&
            norm(a.shipState) === norm(quote.shipState) &&
            norm(a.shipZip) === norm(quote.shipZip)
        )?.label || null
      : null;

  return (
    // Full-height shell: the line-item list scrolls on its own; the bill on the right stays put.
    <div className="flex h-[calc(100vh-2.5rem)] flex-col">
      {/* Slim header — breadcrumb on top; title + status left, meta pushed to the right. */}
      <div className="mb-4">
        <BackLink href="/quotes">All quotes</BackLink>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            <div>
              {quote.quoteName && (
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{quote.ref}</div>
              )}
              <h1 className="text-[22px] font-semibold tracking-tight text-ink">{quote.quoteName || quote.ref}</h1>
            </div>
            {quote.status === "draft" ? (
              <div className="flex items-center gap-2">
                <Badge tone="amber" className="px-2.5 py-0.5 text-[12px]">Draft</Badge>
                {pendingOrder && (
                  <Badge tone="slate" className="px-2.5 py-0.5 text-[12px]">Awaiting payment</Badge>
                )}
              </div>
            ) : (
              <Badge tone="green" className="px-2.5 py-0.5 text-[12px]">Converted</Badge>
            )}
          </div>
          <div className="text-[12.5px] text-ink-soft">{fmtDate(quote.createdAt)}</div>
        </div>
      </div>

      {quote.items.length === 0 ? (
        <EmptyState
          title="This quote is empty"
          description="Add accessories from the catalog to build the quote."
          action={<LinkButton href={`/catalog/accessories?quote=${quote.id}`}>Add accessory</LinkButton>}
        />
      ) : (
        <ShippingRecalcProvider>
        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* LEFT — details + add buttons stay put; only the line-item list scrolls. */}
          <div className="flex min-h-0 flex-col gap-4">
            {/* Order-critical header details — customer, ship-to, references */}
            <div className="rounded-2xl border border-line bg-surface px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3 border-b border-line/70 pb-3">
                {usedAddressLabel ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brass/10 px-2.5 py-1 text-[12px] font-semibold text-brass">
                    <MapPin className="size-3.5" strokeWidth={2} />
                    {usedAddressLabel}
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Quote details
                  </span>
                )}
                {editable && (
                  <QuoteDetailsDrawer quoteId={quote.id} initial={details} accessory={allAccessory} />
                )}
              </div>
              <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
                <DetailBlock label="Customer">
                  {quote.customerName ? (
                    <>
                      <div className="text-[13.5px] font-medium text-ink">{quote.customerName}</div>
                      {quote.customerPhone && <div className="text-[12px] text-muted">{quote.customerPhone}</div>}
                      {quote.customerEmail && <div className="text-[12px] text-muted">{quote.customerEmail}</div>}
                    </>
                  ) : (
                    <span className="text-[12.5px] text-muted">—</span>
                  )}
                </DetailBlock>
                <DetailBlock label="Ship to">
                  {shipLines.length ? (
                    shipLines.map((l, i) => (
                      <div key={i} className="text-[12.5px] text-ink-soft">{l}</div>
                    ))
                  ) : (
                    <span className="text-[12.5px] text-muted">—</span>
                  )}
                </DetailBlock>
                <DetailBlock label="References">
                  <Ref label="Sidemark" value={quote.sidemark} />
                  <Ref label="PO" value={quote.po} />
                  <Ref label="Project" value={quote.projectName} />
                </DetailBlock>
              </div>
            </div>

            {editable && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                {viewerIsAdmin && <AddAdjustmentButton quoteId={quote.id} />}
                <LinkButton href={`/catalog/accessories?quote=${quote.id}`}>+ Add accessory</LinkButton>
              </div>
            )}

            {/* One bordered list with hairline dividers — not a stack of floating cards.
                Scrolls internally so the details + add buttons above stay fixed. */}
            <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-surface">
            {quote.items.map((item) => {
              // Ad-hoc adjustment line (admin surcharge / discount): money-only, no product.
              if (isAdjustmentConfig(item.config)) {
                const cfg = item.config;
                const amount = item.computation.unitPrice;
                const isDiscount = amount < 0;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[15px] font-semibold text-ink">{cfg.label}</span>
                      <span className="rounded-md bg-[#f1efe9] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted">
                        {isDiscount ? "Discount" : "Charge"}
                      </span>
                      {cfg.note && <span className="truncate text-xs text-muted">· {cfg.note}</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <span className={`font-semibold tabular-nums ${isDiscount ? "text-emerald-600" : "text-ink"}`}>
                        {isDiscount ? `−${usd(Math.abs(amount))}` : usd(amount)}
                      </span>
                      {editable && <RemoveItemButton itemId={item.id} />}
                    </div>
                  </div>
                );
              }
              // Accessory line (A-OK motor): fixed price, no color/dimensions.
              if (isAccessoryConfig(item.config)) {
                const cfg = item.config;
                const acc = catalog.model(item.productId);
                const img = cfg.image ?? (acc ? catalog.image(acc) : null);
                // Motor's own base unit price = line unit price minus its sub-parts (per motor).
                const motorBase =
                  Math.round(
                    (item.computation.unitPrice -
                      (cfg.variations ?? []).reduce((s, v) => s + (v.price ?? 0) * (v.qty ?? 1), 0)) * 100
                  ) / 100;
                const motorOverridden = item.computation.componentPrices?.motor !== undefined;
                return (
                  <div key={item.id} className="px-5 py-4">
                    <div className="flex gap-4">
                      {img && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={img} alt={cfg.name} className="size-[72px] shrink-0 rounded-2xl bg-[#0e0e10] object-contain p-1.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[15px] font-semibold text-ink">{cfg.name}</div>
                            <div className="mt-0.5 text-xs text-muted">
                              {cfg.brand} · {cfg.category} · {cfg.sku}
                            </div>
                            {editable &&
                              (() => {
                                const s = item.productId in inventory ? inventory[item.productId] : null;
                                if (s === null) return null;
                                const tone = s <= 0 ? "text-red-500" : s <= 5 ? "text-amber-600" : "text-muted";
                                const label =
                                  s <= 0 ? "Out of stock" : s <= 5 ? `Only ${s} left` : `${s} in stock`;
                                return <div className={`mt-1 text-[11.5px] font-medium ${tone}`}>{label}</div>;
                              })()}
                            {editable
                              ? // Editable draft: the editor below renders variations with qty steppers + stock;
                                // only a legacy crown/driver line (no variations) needs a static row here.
                                !cfg.variations?.length && (
                                  <AccessoryVariations cfg={cfg} motorQty={item.qty} />
                                )
                              : <AccessoryVariations cfg={cfg} motorQty={item.qty} />}
                          </div>
                          <div className="text-right">
                            {/* Main product (motor) own unit price — sub-parts are priced in their rows. */}
                            <div className="font-semibold tabular-nums text-ink">{usd(motorBase)}</div>
                            <div className="text-xs text-muted">unit price</div>
                            {viewerIsAdmin && editable && (
                              <LinePriceEditor
                                itemId={item.id}
                                target="motor"
                                unitPrice={motorBase}
                                overridden={motorOverridden}
                              />
                            )}
                            {/* Locked view has no editor row below, so show the line total here. */}
                            {!editable && (
                              <div className="mt-1 text-xs text-muted">
                                Total {usd(item.computation.unitPrice * item.qty)}
                              </div>
                            )}
                          </div>
                        </div>
                        {editable && (
                          <AccessoryLineEditor
                            itemId={item.id}
                            qty={item.qty}
                            unitPrice={item.computation.unitPrice}
                            motorStock={item.productId in inventory ? inventory[item.productId] : null}
                            moq={acc?.moq ?? 0}
                            isAdmin={viewerIsAdmin}
                            priced={!!item.computation.componentPrices}
                            variations={(cfg.variations ?? []).map(
                              (v): EditorVariation => ({
                                itemId: v.itemId,
                                variationName: v.variationName,
                                itemLabel: v.itemLabel,
                                qty: v.qty ?? 1,
                                price: v.price ?? 0,
                                stock: variationStock[v.itemId] ?? null,
                              })
                            )}
                            availableParts={partsByModel[item.productId] ?? []}
                            partStock={variationStock}
                            exclusionGroups={exclusionMap[item.productId] ?? []}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              const product = getProduct(item.productId);
              const line = product ? getLine(item.lineId as string) : null;
              if (!product || !line) {
                // Catalog product no longer exists — render from the line's stored price only.
                return (
                  <div key={item.id} className="flex items-center justify-between px-5 py-4">
                    <div>
                      <div className="text-[15px] font-semibold text-ink">Product no longer in catalog</div>
                      <div className="mt-0.5 text-xs text-muted">{item.qty} × {usd(item.computation.unitPrice)}</div>
                    </div>
                    <div className="font-semibold tabular-nums text-ink">{usd(item.computation.unitPrice * item.qty)}</div>
                  </div>
                );
              }
              const desc = describeConfig(line, product, item.config);
              return (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex gap-4">
                    {desc.color && (
                      <Swatch color={desc.color} patternStyle={product.patternStyle} size={72} rounded={16} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Link
                            href={
                              editable
                                ? `/configure/${product.id}?quote=${quote.id}&item=${item.id}`
                                : `/configure/${product.id}`
                            }
                            className="text-[15px] font-semibold text-ink hover:text-brass"
                          >
                            {product.name}
                          </Link>
                          <div className="mt-0.5 text-xs text-muted">
                            {line.name} · {product.sku} · {desc.colorName} · {desc.opacityLabel}
                          </div>
                          {desc.location && (
                            <div className="mt-1 text-[12px] font-medium text-ink-soft">📍 {desc.location}</div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-semibold tabular-nums text-ink">
                            {usd(item.computation.unitPrice * item.qty)}
                          </div>
                          <div className="text-xs text-muted">
                            {item.qty} × {usd(item.computation.unitPrice)}
                          </div>
                          {viewerIsAdmin && editable && (
                            <LinePriceEditor
                              itemId={item.id}
                              unitPrice={item.computation.unitPrice}
                              standard={item.computation.priceOverride?.standard ?? null}
                            />
                          )}
                        </div>
                      </div>
                      <div className="mt-2 text-[12.5px] text-ink-soft">{desc.dims}</div>
                      {desc.note && (
                        <div className="mt-1 text-[11.5px] italic text-muted">Note: {desc.note}</div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {desc.options.map((o, i) => (
                          <span key={`${o}-${i}`} className="rounded-md bg-[#f1efe9] px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                            {o}
                          </span>
                        ))}
                      </div>
                      {editable && (
                        <div className="mt-3 flex items-center justify-between">
                          <LineQtyEditor itemId={item.id} qty={item.qty} />
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/configure/${product.id}?quote=${quote.id}&item=${item.id}`}
                              className="text-xs font-medium text-brass transition-colors hover:underline"
                            >
                              Edit
                            </Link>
                            <RemoveItemButton itemId={item.id} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {/* RIGHT — the bill. Sits in its own column so it stays put while the list scrolls. */}
          <div className="min-h-0 space-y-4 overflow-y-auto">
              {/* Customer view: auto-refresh while awaiting the admin's expedite price so the fee +
                  total appear without a manual reload. */}
              {!viewerIsAdmin && (
                <ExpediteStatusPoller active={expediteState.status === "requested"} />
              )}
              <Card className="px-5 py-5">
                <h3 className="text-sm font-semibold text-ink">Summary</h3>
                <dl className="mt-3 space-y-2 text-[13px]">
                  <div className="flex justify-between">
                    <dt className="text-muted">Line items</dt>
                    <dd className="font-medium tabular-nums text-ink">{quote.items.length}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Units</dt>
                    <dd className="font-medium tabular-nums text-ink">
                      {quote.items.reduce((s, i) => s + i.qty, 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Pricing version</dt>
                    <dd className="font-medium text-ink">
                      {[...new Set(quote.items.map((i) => `v${i.computation.pricingVersion}`))].join(", ")}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-2.5">
                    <dt className="text-muted">Subtotal</dt>
                    <dd className="font-medium tabular-nums text-ink-soft">{usd(quote.total)}</dd>
                  </div>
                  {discountPct > 0 && (
                    <div className="flex justify-between text-brass">
                      <dt>Discount ({discountPct}%)</dt>
                      <dd className="font-medium tabular-nums">−{usd(discountAmt)}</dd>
                    </div>
                  )}
                  <ShippingSummaryRow
                    quoteId={quote.id}
                    editable={editable}
                    amount={ship.amount}
                    waiver={ship.waiver}
                    hasGround={ship.hasGround}
                    hasFob={ship.hasFob}
                    leadDays={ship.leadDays}
                    lines={shipLineDetail}
                    expediteStatus={expediteState.status}
                    expediteFee={expediteState.fee}
                    stale={expediteStale}
                  />
                  <div className="flex justify-between border-t border-line pt-2.5 text-[15px]">
                    <dt className="font-semibold text-ink">Total{!ship.hasGround ? " · FOB" : ""}</dt>
                    <dd className="font-semibold tabular-nums text-ink">{usd(grandTotal)}</dd>
                  </div>
                </dl>
              </Card>


              {viewerIsAdmin && editable && ship.hasGround && expediteState.status !== "none" && (
                <AdminExpediteBox
                  quoteId={quote.id}
                  status={expediteState.status}
                  refFee={expediteRef}
                  currentFee={expediteState.fee}
                />
              )}

              {editable ? (
                <>
                  <SubmitPreOrderButton
                    quoteId={quote.id}
                    total={usd(grandTotal)}
                    blockedReason={
                      expediteState.status === "requested"
                        ? "Awaiting expedite price…"
                        : expediteStale
                          ? "Re-confirm expedite price"
                          : undefined
                    }
                  />
                  <DeleteDraftButton quoteId={quote.id} />
                </>
              ) : pendingOrder ? (
                // Unpaid pre-order: quote is still a draft, but locked. Pay or cancel back to draft.
                <PendingPaymentCard orderId={pendingOrder.id} orderRef={pendingOrder.ref} />
              ) : (
                order && (
                  <LinkButton href={`/orders/${order.id}`} className="w-full justify-center">
                    View order {order.ref} →
                  </LinkButton>
                )
              )}
              {/* Access already gated by canAccessOwned above, so "is this the viewer's own quote"
                  reduces to "is it an owned (non-demo) quote" — pass the owner itself (works for
                  admins acting on behalf of a retailer too, where userId is the admin, not the owner). */}
              {canInvoiceQuote(quote, ownerId ?? "") && (
                <LinkButton
                  href={`/invoices/${quote.id}`}
                  variant="secondary"
                  target="_blank"
                  className="w-full justify-center"
                >
                  Invoice / PDF
                </LinkButton>
              )}
          </div>
        </div>
        </ShippingRecalcProvider>
      )}

      {chat && (
        <QuoteChatLauncher
          quote={{ id: quote.id, ref: quote.ref }}
          referenceItems={quoteItemsToRefs(quote.items, catalog)}
          conversationId={chat.conversationId}
          initialMessages={chat.messages}
          initialPeerReadAt={chat.peerReadAt}
          initialUnread={chat.unread}
        />
      )}
    </div>
  );
}
