import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { OrderEventRow, OrderRow, OrderStatus } from "@/lib/types";
import { EVENT_COLS, ORDER_COLS, round2, type ItemAgg, nextRef } from "./internal";
import { ensureSeeded } from "./seed";
import { getQuote } from "./quotes";

export async function submitPreOrder(quoteId: number, sb: SupabaseClient = admin()): Promise<OrderRow> {
  const quote = await getQuote(quoteId, sb);
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "draft") throw new Error("Quote already converted");
  if (quote.items.length === 0) throw new Error("Quote has no items");

  const ref = await nextRef("orders", "PO"); // count across all orders → service_role
  // Create the order FIRST, then flip the quote — so a failed insert can never strand the
  // quote as `converted` with no order. (Not a true transaction; the order-first ordering
  // is the cheap safeguard.)
  const { data: order, error } = await sb
    .from("orders")
    .insert({ ref, quote_id: quoteId, status: "submitted" })
    .select(ORDER_COLS)
    .single();
  if (error) throw error;
  await sb.from("quotes").update({ status: "converted", updated_at: new Date().toISOString() }).eq("id", quoteId);
  await sb.from("order_events").insert({
    order_id: (order as unknown as OrderRow).id,
    status: "submitted",
    actor: "retailer",
    note: `Pre-order ${ref} submitted by ${quote.retailer}. Supplier order file generated and queued for delivery.`,
  });
  return order as unknown as OrderRow;
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
