import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { OrderEventRow, OrderRow, OrderStatus, PaymentMethod } from "@/lib/types";
import { EVENT_COLS, ORDER_COLS, round2, type ItemAgg, insertWithRef } from "./internal";
import { ensureSeeded } from "./seed";
import { getQuote, getQuoteExpedite, getQuoteExpediteState, expediteSignature } from "./quotes";
import { getQuoteOwnerId } from "./ownership";
import { getRetailerDiscount, getShippingWaivers } from "./profile";
import { deductMotorStock, restoreMotorStock } from "./motors";
import { loadCatalog } from "./accessory-catalog";
import { getVariationItemModelMap } from "./variations";
import { computeShipping, DEFAULT_SHIPPING, type MotorRate, type ShippingMode, type ShippingState } from "@/lib/shipping";
import { isAccessoryConfig, PRE_SHIPMENT_STATUSES, REFUNDABLE_STATUSES } from "@/lib/types";

/**
 * Orders needing admin action — only `acknowledged` ones: that's the state an admin has to push
 * forward (ship an accessory order, or move a product order into production). Other states are
 * either waiting on the retailer (awaiting_payment) or already past the admin's hand.
 */
export async function getAdminPendingCount(sb: SupabaseClient = admin()): Promise<number> {
  const { count } = await sb
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "acknowledged");
  return count ?? 0;
}

/** Motor stock needs for a quote's accessory lines (the reservable units). */
function motorNeedsOf(items: { config: unknown; productId: string; qty: number }[]) {
  return items
    .filter((i) => isAccessoryConfig(i.config as never))
    .map((i) => ({ modelId: i.productId, qty: i.qty }));
}

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  stripe: "card (Stripe)",
  paypal: "PayPal",
  bank_transfer: "bank transfer",
};

/**
 * Place a pre-order from a draft quote in `awaiting_payment`. Reserves motor stock and snapshots
 * the amount; the order only enters the fulfilment pipeline once paid (markOrderPaid).
 */
export async function submitPreOrder(
  quoteId: number,
  paymentMethod: PaymentMethod,
  sb: SupabaseClient = admin(),
  // Set when an admin placed this on behalf of the retailer (代下单) — audited in the timeline.
  actingAdmin?: { email: string }
): Promise<OrderRow> {
  const quote = await getQuote(quoteId, sb);
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "draft") throw new Error("Quote already converted");
  if (quote.items.length === 0) throw new Error("Quote has no items");

  // The quote stays "draft" until payment actually succeeds (markOrderPaid flips it to converted),
  // so a half-finished checkout never looks like a placed order. If an unpaid pre-order already
  // exists for this quote (e.g. the retailer came back to pay), reuse it instead of creating a
  // second one and double-reserving stock. A DB partial-unique index on
  // orders(quote_id) WHERE status='awaiting_payment' is the concurrency backstop (see migration).
  const { data: existing } = await sb
    .from("orders")
    .select(ORDER_COLS)
    .eq("quote_id", quoteId)
    .eq("status", "awaiting_payment")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as unknown as OrderRow;

  const motorNeeds = motorNeedsOf(quote.items);
  let reserved = false;
  try {
    // Reserve motor stock (throws naming short models). Released later on cancel.
    if (motorNeeds.length > 0) {
      await deductMotorStock(motorNeeds, admin());
      reserved = true;
    }
    const subtotal = round2(quote.items.reduce((s, i) => s + i.computation.unitPrice * i.qty, 0));
    // Snapshot the retailer's standing discount so a later rate change never alters this order.
    const ownerId = await getQuoteOwnerId(quoteId);
    const discountPct = await getRetailerDiscount(ownerId);
    const net = round2(subtotal * (1 - discountPct / 100));
    // Shipping: compute against the net goods total + the quote's chosen mode, then bake into amount
    // so payment is correct. (FOB → 0; expedite always charged; ground waived ≥ $1000 / waived retailer.)
    const [catalog, waivers, expedite, itemModelMap] = await Promise.all([
      loadCatalog(),
      getShippingWaivers(ownerId),
      getQuoteExpedite(quoteId, sb),
      getVariationItemModelMap(),
    ]);
    // variation item_id → its source model's shipping rate/mode (for sub-parts like brackets).
    const itemRates: Record<string, MotorRate> = {};
    for (const [itemId, modelId] of Object.entries(itemModelMap)) {
      const m = catalog.model(modelId);
      if (m) itemRates[itemId] = { shipGround: m.shipGround, shipExpedite: m.shipExpedite, shipMode: m.shipMode };
    }
    // Per-line by each motor's (and its variations') made-in mode; snapshot mode is "ground" if any.
    const ship = computeShipping(quote.items, catalog, itemRates, expedite, net, waivers);
    // Admin-priced expedite (migration 0026): a flat fee on top, set by the admin after the customer
    // requested it. Can't pay while the request is still awaiting our price.
    const exp = await getQuoteExpediteState(quoteId, sb);
    if (exp.status === "requested") {
      throw new Error("Expedited shipping is awaiting our price — you'll be able to pay once we send the quote.");
    }
    // If the quoted fee no longer matches the current contents (or was never fingerprinted), it's
    // stale — re-confirmation required before paying.
    if (exp.status === "quoted" && exp.sig !== expediteSignature(quote.items)) {
      throw new Error("The quote changed since the expedited price was set — please re-confirm the expedite price before paying.");
    }
    const expediteFee = exp.status === "quoted" ? round2(exp.fee ?? 0) : 0;
    const amount = round2(net + ship.amount + expediteFee);
    // Accessory-only orders use the collapsed 3-step flow (auto-ack + manual tracking); any product
    // line keeps the full 6-step pipeline.
    const accessoryOnly = quote.items.every((i) => isAccessoryConfig(i.config));
    const order = await insertWithRef("orders", "PO", async (ref) => {
      const { data, error } = await sb
        .from("orders")
        .insert({ ref, quote_id: quoteId, status: "awaiting_payment", payment_method: paymentMethod, payment_status: "pending", amount, discount_pct: discountPct, accessory_only: accessoryOnly })
        .select(ORDER_COLS)
        .single();
      if (error) throw error;
      return data as unknown as OrderRow;
    });
    // Snapshot shipping separately (best-effort) so a missing 0023 migration never blocks ordering —
    // pre-migration ships is always FOB/0 anyway, so amount already matches.
    await sb
      .from("orders")
      .update({ ship_mode: ship.hasGround ? "ground" : "fob", ship_expedite: ship.expedite, shipping: round2(ship.amount + expediteFee) })
      .eq("id", order.id)
      .then(undefined, () => {});
    await sb.from("order_events").insert({
      order_id: order.id,
      status: "awaiting_payment",
      actor: "retailer",
      note: actingAdmin
        ? `Pre-order ${order.ref} placed by admin ${actingAdmin.email} on behalf of ${quote.retailer} — awaiting ${PAYMENT_LABEL[paymentMethod]} payment.`
        : `Pre-order ${order.ref} placed by ${quote.retailer} — awaiting ${PAYMENT_LABEL[paymentMethod]} payment.`,
    });
    return order;
  } catch (e) {
    // Roll back any reserved stock so the retailer can retry. The quote was never moved off "draft",
    // so there's nothing to revert there (a concurrent insert that lost the unique-index race lands
    // here too, and only releases the stock it reserved).
    if (reserved) await restoreMotorStock(motorNeeds, admin()).catch(() => {});
    throw e;
  }
}

/**
 * An order's snapshotted shipping (mode/expedite/amount). Read separately (not in ORDER_COLS) so the
 * core order read never breaks before the 0023 migration runs — falls back to FOB / $0.
 */
export async function getOrderShipping(
  orderId: number,
  sb: SupabaseClient = admin()
): Promise<ShippingState & { shipping: number }> {
  const { data, error } = await sb
    .from("orders")
    .select("ship_mode, ship_expedite, shipping")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_SHIPPING, shipping: 0 };
  const row = data as { ship_mode: string | null; ship_expedite: boolean | null; shipping: number | null };
  const mode: ShippingMode = row.ship_mode === "ground" ? "ground" : "fob";
  return { mode, expedite: mode === "ground" && row.ship_expedite === true, shipping: Number(row.shipping ?? 0) };
}

/**
 * Cancel an unpaid (awaiting_payment) order: release reserved motor stock, mark it cancelled,
 * and reopen the quote (→ draft) so the retailer can edit/resubmit. Throws if already paid.
 */
export async function cancelOrder(
  orderId: number,
  actor: OrderEventRow["actor"] = "retailer",
  sb: SupabaseClient = admin()
): Promise<{ quoteId: number }> {
  const { data: ord } = await sb.from("orders").select("status, quote_id").eq("id", orderId).maybeSingle();
  if (!ord) throw new Error("Order not found");
  const o = ord as { status: string; quote_id: number };
  if (o.status !== "awaiting_payment") throw new Error("Only an unpaid order can be cancelled");

  const quote = await getQuote(o.quote_id, admin());
  const motorNeeds = motorNeedsOf(quote?.items ?? []);
  if (motorNeeds.length > 0) await restoreMotorStock(motorNeeds, admin());

  const now = new Date().toISOString();
  await sb.from("orders").update({ status: "cancelled", updated_at: now }).eq("id", orderId);
  await sb.from("quotes").update({ status: "draft", updated_at: now }).eq("id", o.quote_id);
  await sb.from("order_events").insert({
    order_id: orderId,
    status: "note",
    actor,
    note: "Order cancelled before payment — reserved stock released and the quote reopened for editing.",
  });
  return { quoteId: o.quote_id };
}

/**
 * Refund a PAID order in full, at any fulfilment stage. Admin-initiated: snapshots the admin's
 * reason + an optional supporting document and moves the order to the terminal `refunded` status.
 * Reserved motor stock is returned ONLY when refunding pre-shipment (PRE_SHIPMENT_STATUSES) — once
 * shipped the goods have already left, so stock is left untouched. The quote is left as-is (still
 * "converted") — it's shown as Refunded via the order's status, not reopened.
 */
export async function refundOrder(
  orderId: number,
  opts: { reason: string; docPaths?: string[] },
  sb: SupabaseClient = admin()
): Promise<void> {
  const order = await getOrder(orderId, admin()); // need the line items (stock) + amount
  if (!order) throw new Error("Order not found");
  if (order.paymentStatus !== "paid") throw new Error("Only a paid order can be refunded");
  if (!(REFUNDABLE_STATUSES as readonly string[]).includes(order.status)) {
    throw new Error("This order can no longer be refunded — it is already closed.");
  }
  // Only return stock if the goods never shipped; a shipped/in-transit/delivered refund leaves it.
  const preShipment = (PRE_SHIPMENT_STATUSES as readonly string[]).includes(order.status);
  if (preShipment) {
    const motorNeeds = motorNeedsOf(order.quote.items);
    if (motorNeeds.length > 0) await restoreMotorStock(motorNeeds, admin());
  }

  const now = new Date().toISOString();
  const { error } = await sb
    .from("orders")
    .update({
      status: "refunded",
      payment_status: "refunded",
      refund_reason: opts.reason,
      refund_doc_paths: opts.docPaths && opts.docPaths.length ? opts.docPaths : null,
      refunded_at: now,
      updated_at: now,
    })
    .eq("id", orderId);
  if (error) throw error;
  await sb.from("order_events").insert({
    order_id: orderId,
    status: "note",
    actor: "system",
    note: `Order refunded in full (${order.amount != null ? `$${order.amount.toFixed(2)}` : "amount on file"})${preShipment ? " — reserved stock released" : ""}. Reason: ${opts.reason}`,
  });
}

/** Hours an unpaid order may sit before it's auto-cancelled and its stock released. */
export const AWAITING_EXPIRY_HOURS = 72;

/**
 * Auto-cancel awaiting_payment orders older than `maxAgeHours` (releasing reserved stock).
 * Run lazily (admin console load) and/or from a scheduled job. Returns how many were expired.
 */
export async function expireStaleAwaitingOrders(
  maxAgeHours = AWAITING_EXPIRY_HOURS,
  sb: SupabaseClient = admin()
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const { data } = await sb
    .from("orders")
    .select("id")
    .eq("status", "awaiting_payment")
    .lt("created_at", cutoff);
  const ids = ((data ?? []) as { id: number }[]).map((r) => r.id);
  let expired = 0;
  for (const id of ids) {
    try {
      await cancelOrder(id, "system", sb);
      expired++;
    } catch {
      /* skip and continue */
    }
  }
  return expired;
}

const rand = (len: number) => {
  let s = "";
  for (let i = 0; i < len; i++) s += Math.floor(Math.random() * 10);
  return s;
};

/**
 * Mark an order paid and move it into the pipeline (`submitted`). For accessory-only orders the
 * payment ALSO auto-completes the `acknowledged` step (the collapsed 3-step flow): we record the
 * `submitted` milestone, then immediately issue the supplier order no. + ETA and land on
 * `acknowledged` — the supplier's only remaining step is shipping. Product orders stay at
 * `submitted` and follow the full 6-step pipeline (manual acknowledge). Idempotent: a no-op if the
 * order is no longer awaiting payment. `proofPath` records a bank-transfer receipt.
 */
export async function markOrderPaid(
  orderId: number,
  opts: { ref?: string | null; proofPath?: string | null } = {},
  sb: SupabaseClient = admin()
): Promise<void> {
  const { data: cur } = await sb
    .from("orders")
    .select("status, payment_method, accessory_only, quote_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!cur) throw new Error("Order not found");
  const row = cur as { status: string; payment_method: PaymentMethod | null; accessory_only: boolean | null; quote_id: number };
  if (row.status !== "awaiting_payment") return; // already paid / in pipeline
  const now = new Date().toISOString();
  const accessoryOnly = row.accessory_only === true;
  const patch: Record<string, unknown> = { payment_status: "paid", paid_at: now, status: "submitted", updated_at: now };
  if (opts.ref !== undefined) patch.payment_ref = opts.ref;
  if (opts.proofPath !== undefined) patch.payment_proof_path = opts.proofPath;

  const method = row.payment_method;
  const events: Record<string, unknown>[] = [
    {
      order_id: orderId,
      status: "submitted",
      actor: method === "bank_transfer" ? "system" : "retailer",
      note: `Payment received (${method ? PAYMENT_LABEL[method] : "payment"}). Pre-order submitted to supplier.`,
    },
  ];

  // Accessory-only: auto-acknowledge (issue supplier order no. + ETA) so the only manual step is shipping.
  if (accessoryOnly) {
    const supplierOrderNo = `SZF-${rand(5)}`;
    const eta = new Date();
    eta.setDate(eta.getDate() + 21);
    const etaDate = eta.toISOString().slice(0, 10);
    patch.status = "acknowledged";
    patch.supplier_order_no = supplierOrderNo;
    patch.eta_date = etaDate;
    events.push({
      order_id: orderId,
      status: "acknowledged",
      actor: "supplier",
      note: `Supplier confirmed order — purchase order no. ${supplierOrderNo}. ETA ${etaDate}.`,
    });
  }

  const { error } = await sb.from("orders").update(patch).eq("id", orderId);
  if (error) throw error;
  await sb.from("order_events").insert(events);
  // Payment succeeded → the quote is now truly an order. (It was kept on "draft" until this point so
  // an unpaid checkout never showed as converted.)
  await sb.from("quotes").update({ status: "converted", updated_at: now }).eq("id", row.quote_id);
}

/** Flag a failed gateway payment; the order stays `awaiting_payment` so the retailer can retry. */
export async function markOrderPaymentFailed(orderId: number, reason: string, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb
    .from("orders")
    .update({ payment_status: "failed", updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("status", "awaiting_payment");
  if (error) throw error;
  await sb.from("order_events").insert({
    order_id: orderId,
    status: "note",
    actor: "system",
    note: `Payment failed${reason ? `: ${reason}` : ""}. You can retry payment.`,
  });
}

type OrderListRow = OrderRow & {
  quoteRef: string;
  retailer: string;
  projectName: string | null;
  itemCount: number;
  total: number;
};

export async function getOrders(ownerId?: string, sb: SupabaseClient = admin()): Promise<OrderListRow[]> {
  await ensureSeeded();
  const { data: orders, error } = await sb.from("orders").select(ORDER_COLS).order("id", { ascending: false });
  if (error) throw error;
  const orderRows = (orders ?? []) as unknown as OrderRow[];
  if (orderRows.length === 0) return [];

  const quoteIds = [...new Set(orderRows.map((o) => o.quoteId))];
  const { data: quotes } = await sb
    .from("quotes")
    .select("id, ref, retailer, ownerId:owner_id, projectName:project_name")
    .in("id", quoteIds);
  const { data: items } = await sb.from("quote_items").select("quoteId:quote_id, qty, computation").in("quote_id", quoteIds);
  const qById = new Map(
    ((quotes ?? []) as unknown as { id: number; ref: string; retailer: string; ownerId: string | null; projectName: string | null }[]).map((q) => [q.id, q])
  );
  const aggs = (items ?? []) as unknown as ItemAgg[];

  // Resolve the *live* retailer name from each owner's profile (company → email), so the column
  // reflects the actual account rather than the name snapshotted onto the quote at creation time.
  // Public/demo quotes (owner_id null) keep their snapshot label.
  const ownerIds = [...new Set([...qById.values()].map((q) => q.ownerId).filter((id): id is string => !!id))];
  const nameByOwner = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profiles } = await admin().from("profiles").select("id, email, company").in("id", ownerIds);
    for (const p of (profiles ?? []) as { id: string; email: string | null; company: string | null }[]) {
      nameByOwner.set(p.id, p.company?.trim() || p.email || "");
    }
  }

  return orderRows
    .filter((o) => {
      if (!ownerId) return true; // back-office (Supplier Console): all orders
      const owner = qById.get(o.quoteId)?.ownerId ?? null;
      return owner === null || owner === ownerId; // mine + public demo samples
    })
    .map((o) => {
      const q = qById.get(o.quoteId);
      const its = aggs.filter((i) => i.quoteId === o.quoteId);
      const total = round2(its.reduce((s, i) => s + (i.computation?.unitPrice ?? 0) * i.qty, 0));
      return {
        ...o,
        quoteRef: q?.ref ?? "",
        retailer: (q?.ownerId ? nameByOwner.get(q.ownerId) : "") || q?.retailer || "",
        projectName: q?.projectName ?? null,
        itemCount: its.length,
        total,
      };
    });
}

/**
 * A retailer's most frequently ordered accessory parts, ranked by how many of their (non-cancelled)
 * orders each part appears in (tie-break: total quantity). Returns model ids + counts only — the
 * caller enriches with the live catalog (and drops models that are gone / no longer orderable).
 */
export async function getFrequentPartIds(
  ownerId: string,
  limit = 3,
  sb: SupabaseClient = admin()
): Promise<{ modelId: string; orderCount: number; totalQty: number }[]> {
  if (!ownerId) return [];
  // One round-trip: this retailer's non-cancelled orders (joined to their owning quote).
  const { data: orders } = await sb
    .from("orders")
    .select("quote_id, quotes!inner(owner_id)")
    .eq("quotes.owner_id", ownerId)
    .neq("status", "cancelled");
  const orderedQuoteIds = [...new Set(((orders ?? []) as { quote_id: number }[]).map((o) => o.quote_id))];
  if (orderedQuoteIds.length === 0) return [];
  const { data: items } = await sb
    .from("quote_items")
    .select("quote_id, product_id, qty")
    .eq("line_id", "accessory")
    .in("quote_id", orderedQuoteIds);

  const agg = new Map<string, { orders: Set<number>; qty: number }>();
  for (const it of (items ?? []) as { quote_id: number; product_id: string; qty: number }[]) {
    const e = agg.get(it.product_id) ?? { orders: new Set<number>(), qty: 0 };
    e.orders.add(it.quote_id);
    e.qty += it.qty;
    agg.set(it.product_id, e);
  }
  return [...agg.entries()]
    .map(([modelId, e]) => ({ modelId, orderCount: e.orders.size, totalQty: e.qty }))
    .sort((a, b) => b.orderCount - a.orderCount || b.totalQty - a.totalQty)
    .slice(0, limit);
}

export async function getOrder(
  id: number,
  sb: SupabaseClient = admin()
): Promise<(OrderRow & { quote: NonNullable<Awaited<ReturnType<typeof getQuote>>>; events: OrderEventRow[] }) | undefined> {
  await ensureSeeded();
  const { data: o, error } = await sb.from("orders").select(ORDER_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!o) return undefined;
  const order = o as unknown as OrderRow;
  const quote = await getQuote(order.quoteId, sb);
  if (!quote) return undefined;
  const { data: events, error: e2 } = await sb
    .from("order_events")
    .select(EVENT_COLS)
    .eq("order_id", id)
    .order("id", { ascending: false });
  if (e2) throw e2;
  return { ...order, quote, events: (events ?? []) as unknown as OrderEventRow[] };
}

/**
 * Switch the payment method on an unpaid order (retailer changed their mind before paying).
 * Only allowed while still awaiting_payment; resets payment_status to "pending" so a prior failed
 * gateway attempt doesn't stick. Must run with the service_role client — RLS lets only admins
 * UPDATE orders (ownership is enforced at the route gate). No fulfilment event: the order hasn't
 * moved stages, only how it will be paid.
 */
export async function changeOrderPaymentMethod(
  orderId: number,
  method: PaymentMethod,
  sb: SupabaseClient = admin()
): Promise<void> {
  const { data: ord } = await sb.from("orders").select("status").eq("id", orderId).maybeSingle();
  if (!ord) throw new Error("Order not found");
  if ((ord as { status: string }).status !== "awaiting_payment") {
    throw new Error("Payment method can only be changed before payment");
  }
  const { error } = await sb
    .from("orders")
    .update({ payment_method: method, payment_status: "pending", updated_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw error;
}

export async function updateOrder(
  id: number,
  patch: Partial<Pick<OrderRow, "status" | "supplierOrderNo" | "trackingNo" | "trackingNos" | "carrier" | "etaDate">>,
  event: { status: OrderStatus | "note"; note: string; actor: OrderEventRow["actor"] },
  sb: SupabaseClient = admin()
): Promise<OrderRow> {
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.supplierOrderNo !== undefined) dbPatch.supplier_order_no = patch.supplierOrderNo;
  if (patch.trackingNo !== undefined) dbPatch.tracking_no = patch.trackingNo;
  if (patch.trackingNos !== undefined) dbPatch.tracking_nos = patch.trackingNos;
  if (patch.carrier !== undefined) dbPatch.carrier = patch.carrier;
  if (patch.etaDate !== undefined) dbPatch.eta_date = patch.etaDate;

  const { data, error } = await sb.from("orders").update(dbPatch).eq("id", id).select(ORDER_COLS).single();
  if (error) throw error;
  await sb.from("order_events").insert({ order_id: id, status: event.status, note: event.note, actor: event.actor });
  return data as unknown as OrderRow;
}

export async function getRecentEvents(
  limit = 10,
  ownerId?: string,
  sb: SupabaseClient = admin()
): Promise<(OrderEventRow & { orderRef: string })[]> {
  await ensureSeeded();
  const { data, error } = await sb
    .from("order_events")
    .select(`${EVENT_COLS}, orders(ref, quotes(owner_id))`)
    .order("id", { ascending: false })
    .limit(ownerId ? 200 : limit);
  if (error) throw error;
  const rows = (data ?? []) as unknown as (OrderEventRow & {
    orders: { ref: string; quotes: { owner_id: string | null } | null } | null;
  })[];
  const filtered = ownerId
    ? rows.filter((e) => {
        const owner = e.orders?.quotes?.owner_id ?? null;
        return owner === null || owner === ownerId; // mine + public demo samples
      })
    : rows;
  return filtered.slice(0, limit).map((e) => ({
    id: e.id,
    orderId: e.orderId,
    status: e.status,
    note: e.note,
    actor: e.actor,
    createdAt: e.createdAt,
    orderRef: e.orders?.ref ?? "",
  }));
}
