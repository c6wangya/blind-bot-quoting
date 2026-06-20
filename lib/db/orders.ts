import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { OrderEventRow, OrderRow, OrderStatus, PaymentMethod } from "@/lib/types";
import { EVENT_COLS, ORDER_COLS, round2, type ItemAgg, nextRef } from "./internal";
import { ensureSeeded } from "./seed";
import { getQuote } from "./quotes";
import { deductMotorStock, restoreMotorStock } from "./motors";
import { isAccessoryConfig } from "@/lib/types";

/** Orders needing admin action: new submissions to acknowledge + bank transfers to confirm. */
export async function getAdminPendingCount(sb: SupabaseClient = admin()): Promise<number> {
  const { count } = await sb
    .from("orders")
    .select("id", { count: "exact", head: true })
    .or("status.eq.submitted,and(status.eq.awaiting_payment,payment_method.eq.bank_transfer)");
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
  sb: SupabaseClient = admin()
): Promise<OrderRow> {
  const quote = await getQuote(quoteId, sb);
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "draft") throw new Error("Quote already converted");
  if (quote.items.length === 0) throw new Error("Quote has no items");

  // Atomic double-submit gate: flip draft→converted; only the request that actually changed a
  // row proceeds, so a double-click / two tabs can't both create an order + double-reserve stock.
  const { data: won } = await sb
    .from("quotes")
    .update({ status: "converted", updated_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("status", "draft")
    .select("id");
  if (!won || won.length === 0) throw new Error("This quote has already been submitted");

  const motorNeeds = motorNeedsOf(quote.items);
  let reserved = false;
  try {
    // Reserve motor stock (throws naming short models). Released later on cancel.
    if (motorNeeds.length > 0) {
      await deductMotorStock(motorNeeds, admin());
      reserved = true;
    }
    const amount = round2(quote.items.reduce((s, i) => s + i.computation.unitPrice * i.qty, 0));
    const ref = await nextRef("orders", "PO");
    const { data: order, error } = await sb
      .from("orders")
      .insert({ ref, quote_id: quoteId, status: "awaiting_payment", payment_method: paymentMethod, payment_status: "pending", amount })
      .select(ORDER_COLS)
      .single();
    if (error) throw error;
    await sb.from("order_events").insert({
      order_id: (order as unknown as OrderRow).id,
      status: "awaiting_payment",
      actor: "retailer",
      note: `Pre-order ${ref} placed by ${quote.retailer} — awaiting ${PAYMENT_LABEL[paymentMethod]} payment.`,
    });
    return order as unknown as OrderRow;
  } catch (e) {
    // Roll back the gate (+ any reserved stock) so the retailer can retry.
    if (reserved) await restoreMotorStock(motorNeeds, admin()).catch(() => {});
    await sb.from("quotes").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", quoteId);
    throw e;
  }
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
 * Mark an order paid and move it into the pipeline (`submitted`). Idempotent: a no-op if the
 * order is no longer awaiting payment. `proofPath` records a bank-transfer receipt.
 */
export async function markOrderPaid(
  orderId: number,
  opts: { ref?: string | null; proofPath?: string | null } = {},
  sb: SupabaseClient = admin()
): Promise<void> {
  const { data: cur } = await sb.from("orders").select("status, payment_method").eq("id", orderId).maybeSingle();
  if (!cur) throw new Error("Order not found");
  if ((cur as { status: string }).status !== "awaiting_payment") return; // already paid / in pipeline
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { payment_status: "paid", paid_at: now, status: "submitted", updated_at: now };
  if (opts.ref !== undefined) patch.payment_ref = opts.ref;
  if (opts.proofPath !== undefined) patch.payment_proof_path = opts.proofPath;
  const { error } = await sb.from("orders").update(patch).eq("id", orderId);
  if (error) throw error;
  const method = (cur as { payment_method: PaymentMethod | null }).payment_method;
  await sb.from("order_events").insert({
    order_id: orderId,
    status: "submitted",
    actor: method === "bank_transfer" ? "system" : "retailer",
    note: `Payment received (${method ? PAYMENT_LABEL[method] : "payment"}). Pre-order submitted to supplier.`,
  });
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
        retailer: q?.retailer ?? "",
        projectName: q?.projectName ?? null,
        itemCount: its.length,
        total,
      };
    });
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

export async function updateOrder(
  id: number,
  patch: Partial<Pick<OrderRow, "status" | "supplierOrderNo" | "trackingNo" | "carrier" | "etaDate">>,
  event: { status: OrderStatus | "note"; note: string; actor: OrderEventRow["actor"] },
  sb: SupabaseClient = admin()
): Promise<OrderRow> {
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.supplierOrderNo !== undefined) dbPatch.supplier_order_no = patch.supplierOrderNo;
  if (patch.trackingNo !== undefined) dbPatch.tracking_no = patch.trackingNo;
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
