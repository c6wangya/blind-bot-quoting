import {
  DRAPERY_PRICING_V1,
  PRODUCTS,
  PRODUCT_LINES,
  ROLLER_PRICING_V1,
  ROLLER_PRICING_V2,
} from "./catalog-data";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCESSORY_BRAND,
  ACCESSORY_PRICING_VERSION,
  getAccessoryCategory,
  type AccessoryModel,
} from "./accessories-data";
import { computeQuote } from "./pricing";
import { admin } from "./supabase/admin";
import type {
  AccessoryConfig,
  ItemConfig,
  OrderEventRow,
  OrderRow,
  OrderStatus,
  PricingVersionRow,
  Product,
  ProductLine,
  QuoteComputation,
  QuoteItemRow,
  QuoteRow,
} from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Column lists with snake_case → camelCase aliases, so DB rows hydrate directly
// into the camelCase domain types (TS types + components stay unchanged).
const PRICING_COLS = "id, lineId:line_id, version, active, note, config, createdAt:created_at";
const QUOTE_COLS = "id, ref, retailer, status, projectName:project_name, createdAt:created_at, updatedAt:updated_at";
const ITEM_COLS = "id, quoteId:quote_id, productId:product_id, lineId:line_id, qty, config, computation, createdAt:created_at";
const ORDER_COLS = "id, ref, quoteId:quote_id, status, supplierOrderNo:supplier_order_no, trackingNo:tracking_no, carrier, etaDate:eta_date, createdAt:created_at, updatedAt:updated_at";
const EVENT_COLS = "id, orderId:order_id, status, note, actor, createdAt:created_at";

type ItemAgg = { quoteId: number; qty: number; computation: { unitPrice: number } };

// ---------------- catalog (static data, not in the DB) ----------------

export function getLines(): ProductLine[] {
  return PRODUCT_LINES;
}

export function getLine(lineId: string): ProductLine | undefined {
  return PRODUCT_LINES.find((l) => l.id === lineId);
}

export function getProducts(lineId?: string): Product[] {
  return lineId ? PRODUCTS.filter((p) => p.lineId === lineId) : PRODUCTS;
}

export function getProduct(productId: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === productId);
}

/** The signed-in retailer's profile fields used for the account display. */
export async function getProfile(
  userId: string
): Promise<{ email: string; company: string | null; role: "retailer" | "admin" } | null> {
  const { data, error } = await admin()
    .from("profiles")
    .select("email, company, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    // The `role` column is added by an out-of-band migration; until it lands, fall back
    // to reading the always-present columns and treat everyone as a retailer.
    const { data: d2, error: e2 } = await admin()
      .from("profiles")
      .select("email, company")
      .eq("id", userId)
      .maybeSingle();
    if (e2) throw e2;
    if (!d2) return null;
    const r = d2 as { email: string; company: string | null };
    return { email: r.email, company: r.company, role: "retailer" };
  }
  if (!data) return null;
  const row = data as { email: string; company: string | null; role: string | null };
  return { email: row.email, company: row.company, role: row.role === "admin" ? "admin" : "retailer" };
}

/** Owner of a quote: a user id, null for public demo samples, or undefined if not found. */
export async function getQuoteOwnerId(quoteId: number): Promise<string | null | undefined> {
  const { data } = await admin().from("quotes").select("owner_id").eq("id", quoteId).maybeSingle();
  return data ? (data as { owner_id: string | null }).owner_id : undefined;
}

/** Owner of an order (via its quote): a user id, null for public demo samples, or undefined if not found. */
export async function getOrderOwnerId(orderId: number): Promise<string | null | undefined> {
  const { data: o } = await admin().from("orders").select("quote_id").eq("id", orderId).maybeSingle();
  if (!o) return undefined;
  return getQuoteOwnerId((o as { quote_id: number }).quote_id);
}

// ---------------- seed (runs once per process, idempotent) ----------------

export const DEMO_RETAILER = "Harbor & Lane Interiors";

let seedPromise: Promise<void> | null = null;
function ensureSeeded(): Promise<void> {
  return (seedPromise ??= seed());
}

async function seed(): Promise<void> {
  const a = admin();

  const { count: pvCount } = await a
    .from("pricing_versions")
    .select("*", { count: "exact", head: true });
  if (!pvCount) {
    await a.from("pricing_versions").insert([
      { line_id: "roller-shade", version: "2026.1", active: false, note: "Initial FOB grid", config: ROLLER_PRICING_V1 },
      {
        line_id: "roller-shade",
        version: "2026.2",
        active: true,
        note: "Q2 freight adjustment: motorized +$5, blackout multiplier 1.28→1.30",
        config: ROLLER_PRICING_V2,
      },
      { line_id: "drapery", version: "2026.1", active: true, note: "Initial cut-and-make formula", config: DRAPERY_PRICING_V1 },
    ]);
  }

  const { count: qCount } = await a.from("quotes").select("*", { count: "exact", head: true });
  if (qCount) return;

  const mkQuote = async (
    ref: string,
    projectName: string,
    createdAt: string,
    status: "draft" | "converted",
    items: { productId: string; qty: number; config: ItemConfig }[]
  ): Promise<number> => {
    const { data: quote, error } = await a
      .from("quotes")
      .insert({ ref, retailer: DEMO_RETAILER, status, project_name: projectName, created_at: createdAt, updated_at: createdAt })
      .select("id")
      .single();
    if (error) throw error;
    const quoteId = (quote as { id: number }).id;
    const rows = items.map((it) => {
      const product = getProduct(it.productId)!;
      const line = getLine(product.lineId)!;
      const pricingCfg = product.lineId === "roller-shade" ? ROLLER_PRICING_V2 : DRAPERY_PRICING_V1;
      const version = product.lineId === "roller-shade" ? "2026.2" : "2026.1";
      const computation = computeQuote(line, product, it.config, pricingCfg, version);
      return {
        quote_id: quoteId,
        product_id: product.id,
        line_id: product.lineId,
        qty: it.qty,
        config: it.config,
        computation,
        created_at: createdAt,
      };
    });
    await a.from("quote_items").insert(rows);
    return quoteId;
  };

  const q1 = await mkQuote("Q-2026-0001", "Maple St. Townhomes — Unit 4B", "2026-05-12 09:14:00", "converted", [
    {
      productId: "rs-roller-shade",
      qty: 6,
      config: { colorId: "gray", opacityId: "privacy", options: { mount: "inside", control: "cordless", headrail: "white-cassette", sideChannel: "none" }, dimensions: { width: 120, height: 160 } },
    },
    {
      productId: "rs-roller-shade",
      qty: 2,
      config: { colorId: "charcoal", opacityId: "blackout", options: { mount: "outside", control: "motorized", headrail: "fascia", sideChannel: "black" }, dimensions: { width: 180, height: 210 } },
    },
  ]);

  const q2 = await mkQuote("Q-2026-0002", "Hotel Meridian — Floor 7 refresh", "2026-05-26 14:40:00", "converted", [
    {
      productId: "dp-standard-drapery",
      qty: 12,
      config: { colorId: "grey", opacityId: "blackout", options: { fullness: "2.5x", header: "ripplefold", liner: "blackout", control: "cord-draw", stack: "split", rodColor: "matte-black" }, dimensions: { rodWidth: 320, height: 260 } },
    },
    {
      productId: "dp-standard-drapery",
      qty: 12,
      config: { colorId: "white", opacityId: "sheer", options: { fullness: "3x", header: "ripplefold", liner: "unlined", control: "baton-draw", stack: "split", rodColor: "matte-black" }, dimensions: { rodWidth: 320, height: 258 } },
    },
  ]);

  const mkOrder = async (
    ref: string,
    quoteId: number,
    fields: Record<string, unknown>,
    events: [OrderStatus, string, OrderEventRow["actor"], string][]
  ) => {
    const { data: order, error } = await a
      .from("orders")
      .insert({ ref, quote_id: quoteId, ...fields })
      .select("id")
      .single();
    if (error) throw error;
    const orderId = (order as { id: number }).id;
    await a.from("order_events").insert(
      events.map(([status, note, actor, created_at]) => ({ order_id: orderId, status, note, actor, created_at }))
    );
  };

  await mkOrder(
    "PO-2026-0001",
    q1,
    { status: "delivered", supplier_order_no: "SZF-88217", tracking_no: "SF1029384756021", carrier: "SF Express Intl", eta_date: "2026-06-02", created_at: "2026-05-12 10:02:00", updated_at: "2026-06-02 16:21:00" },
    [
      ["submitted", "Pre-order PO-2026-0001 submitted. Supplier order file generated and queued for delivery.", "retailer", "2026-05-12 10:02:00"],
      ["acknowledged", "Supplier confirmed order — supplier order no. SZF-88217.", "supplier", "2026-05-13 03:12:00"],
      ["in_production", "Fabric cut and rolling started at Shenzhen facility.", "supplier", "2026-05-15 08:30:00"],
      ["shipped", "Shipment handed to SF Express Intl — tracking SF1029384756021.", "supplier", "2026-05-24 11:05:00"],
      ["in_transit", "Cleared export customs, in linehaul to destination.", "logistics", "2026-05-27 19:44:00"],
      ["delivered", "Delivered and signed for at receiving dock.", "logistics", "2026-06-02 16:21:00"],
    ]
  );

  await mkOrder(
    "PO-2026-0002",
    q2,
    { status: "in_production", supplier_order_no: "SZF-88341", eta_date: "2026-06-24", created_at: "2026-05-26 15:10:00", updated_at: "2026-06-01 07:55:00" },
    [
      ["submitted", "Pre-order PO-2026-0002 submitted. Supplier order file generated and queued for delivery.", "retailer", "2026-05-26 15:10:00"],
      ["acknowledged", "Supplier confirmed order — supplier order no. SZF-88341. ETA 2026-06-24.", "supplier", "2026-05-27 02:48:00"],
      ["in_production", "Cut-and-sew in progress — 12 of 24 panels complete.", "supplier", "2026-06-01 07:55:00"],
    ]
  );
}

// ---------------- pricing ----------------

export async function getActivePricing(lineId: string): Promise<PricingVersionRow> {
  await ensureSeeded();
  const { data, error } = await admin()
    .from("pricing_versions")
    .select(PRICING_COLS)
    .eq("line_id", lineId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No active pricing version for ${lineId}`);
  return data as unknown as PricingVersionRow;
}

export async function getAllPricingVersions(): Promise<PricingVersionRow[]> {
  await ensureSeeded();
  const { data, error } = await admin()
    .from("pricing_versions")
    .select(PRICING_COLS)
    .order("line_id")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as PricingVersionRow[];
}

// ---------------- quotes ----------------

function nextRefFrom(count: number, prefix: string): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}

async function nextRef(table: "quotes" | "orders", prefix: string): Promise<string> {
  const { count } = await admin().from(table).select("*", { count: "exact", head: true });
  return nextRefFrom(count ?? 0, prefix);
}

export async function getDraftQuote(ownerId: string, sb: SupabaseClient = admin()): Promise<QuoteRow | undefined> {
  await ensureSeeded();
  const { data, error } = await sb
    .from("quotes")
    .select(QUOTE_COLS)
    .eq("status", "draft")
    .eq("owner_id", ownerId)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as QuoteRow | undefined;
}

export async function getOrCreateDraftQuote(
  ownerId: string,
  projectName?: string,
  sb: SupabaseClient = admin()
): Promise<QuoteRow> {
  const existing = await getDraftQuote(ownerId, sb);
  if (existing) return existing;
  const ref = await nextRef("quotes", "Q"); // count across all quotes → service_role
  const { data, error } = await sb
    .from("quotes")
    .insert({ ref, retailer: DEMO_RETAILER, status: "draft", owner_id: ownerId, project_name: projectName ?? null })
    .select(QUOTE_COLS)
    .single();
  if (error) throw error;
  return data as unknown as QuoteRow;
}

export async function addQuoteItem(
  quoteId: number,
  product: Product,
  config: ItemConfig,
  qty: number,
  computation: QuoteComputation,
  sb: SupabaseClient = admin()
): Promise<QuoteItemRow> {
  const { data, error } = await sb
    .from("quote_items")
    .insert({ quote_id: quoteId, product_id: product.id, line_id: product.lineId, qty, config, computation })
    .select(ITEM_COLS)
    .single();
  if (error) throw error;
  await sb.from("quotes").update({ updated_at: new Date().toISOString() }).eq("id", quoteId);
  return data as unknown as QuoteItemRow;
}

export async function removeQuoteItem(itemId: number, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("quote_items").delete().eq("id", itemId);
  if (error) throw error;
}

/** Delete a draft quote and all its items. Items first (in case the FK isn't cascade). */
export async function deleteQuote(quoteId: number, sb: SupabaseClient = admin()): Promise<void> {
  await sb.from("quote_items").delete().eq("quote_id", quoteId);
  const { error } = await sb.from("quotes").delete().eq("id", quoteId);
  if (error) throw error;
}

/**
 * Add an A-OK accessory (e.g. a motor) to a quote — fixed price, no dimensions/config.
 * Stored in the same quote_items table as full products so it flows through the same
 * quote → pre-order → Excel → tracking pipeline. lineId = "accessory".
 */
export async function addAccessoryItem(
  quoteId: number,
  model: AccessoryModel,
  qty: number,
  sb: SupabaseClient = admin()
): Promise<QuoteItemRow> {
  const category = getAccessoryCategory(model.categoryId);
  const config: AccessoryConfig = {
    kind: "accessory",
    sku: model.sku,
    name: model.name,
    brand: ACCESSORY_BRAND.name,
    category: category?.name ?? model.categoryId,
  };
  const price = model.price ?? 0;
  const computation: QuoteComputation = {
    unitPrice: price,
    currency: "USD",
    lines: [{ label: "Unit price", detail: model.sku, amount: price }],
    facts: [
      { label: "Brand", value: ACCESSORY_BRAND.name },
      { label: "Model #", value: model.sku },
    ],
    pricingVersion: ACCESSORY_PRICING_VERSION,
  };
  const { data, error } = await sb
    .from("quote_items")
    .insert({ quote_id: quoteId, product_id: model.id, line_id: "accessory", qty, config, computation })
    .select(ITEM_COLS)
    .single();
  if (error) throw error;
  await sb.from("quotes").update({ updated_at: new Date().toISOString() }).eq("id", quoteId);
  return data as unknown as QuoteItemRow;
}

export async function getQuotes(
  ownerId: string,
  sb: SupabaseClient = admin()
): Promise<(QuoteRow & { itemCount: number; total: number })[]> {
  await ensureSeeded();
  const { data: quotes, error } = await sb
    .from("quotes")
    .select(QUOTE_COLS)
    .or(`owner_id.eq.${ownerId},owner_id.is.null`)
    .order("id", { ascending: false });
  if (error) throw error;
  const { data: items, error: e2 } = await sb.from("quote_items").select("quoteId:quote_id, qty, computation");
  if (e2) throw e2;
  const aggs = (items ?? []) as unknown as ItemAgg[];
  return ((quotes ?? []) as unknown as QuoteRow[]).map((q) => {
    const its = aggs.filter((i) => i.quoteId === q.id);
    const total = round2(its.reduce((s, i) => s + (i.computation?.unitPrice ?? 0) * i.qty, 0));
    return { ...q, itemCount: its.length, total };
  });
}

export async function getQuote(
  id: number,
  sb: SupabaseClient = admin()
): Promise<(QuoteRow & { items: QuoteItemRow[]; total: number }) | undefined> {
  await ensureSeeded();
  const { data: q, error } = await sb.from("quotes").select(QUOTE_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!q) return undefined;
  const { data: items, error: e2 } = await sb
    .from("quote_items")
    .select(ITEM_COLS)
    .eq("quote_id", id)
    .order("id");
  if (e2) throw e2;
  const rows = (items ?? []) as unknown as QuoteItemRow[];
  const total = round2(rows.reduce((s, i) => s + i.computation.unitPrice * i.qty, 0));
  return { ...(q as unknown as QuoteRow), items: rows, total };
}

/** For the quote detail page: the order a converted quote turned into, if any. */
export async function getOrderRefByQuote(
  quoteId: number,
  sb: SupabaseClient = admin()
): Promise<{ id: number; ref: string } | undefined> {
  const { data, error } = await sb.from("orders").select("id, ref").eq("quote_id", quoteId).maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as { id: number; ref: string } | undefined;
}

// ---------------- orders ----------------

export async function submitPreOrder(quoteId: number, sb: SupabaseClient = admin()): Promise<OrderRow> {
  const quote = await getQuote(quoteId, sb);
  if (!quote) throw new Error("Quote not found");
  if (quote.status !== "draft") throw new Error("Quote already converted");
  if (quote.items.length === 0) throw new Error("Quote has no items");

  const ref = await nextRef("orders", "PO"); // count across all orders → service_role
  await sb.from("quotes").update({ status: "converted", updated_at: new Date().toISOString() }).eq("id", quoteId);
  const { data: order, error } = await sb
    .from("orders")
    .insert({ ref, quote_id: quoteId, status: "submitted" })
    .select(ORDER_COLS)
    .single();
  if (error) throw error;
  await sb.from("order_events").insert({
    order_id: (order as unknown as OrderRow).id,
    status: "submitted",
    actor: "retailer",
    note: `Pre-order ${ref} submitted by ${quote.retailer}. Supplier order file generated and queued for delivery.`,
  });
  return order as unknown as OrderRow;
}

export type OrderListRow = OrderRow & {
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
  event: { status: OrderStatus | "note"; note: string; actor: OrderEventRow["actor"] }
): Promise<OrderRow> {
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.supplierOrderNo !== undefined) dbPatch.supplier_order_no = patch.supplierOrderNo;
  if (patch.trackingNo !== undefined) dbPatch.tracking_no = patch.trackingNo;
  if (patch.carrier !== undefined) dbPatch.carrier = patch.carrier;
  if (patch.etaDate !== undefined) dbPatch.eta_date = patch.etaDate;

  const { data, error } = await admin().from("orders").update(dbPatch).eq("id", id).select(ORDER_COLS).single();
  if (error) throw error;
  await admin().from("order_events").insert({ order_id: id, status: event.status, note: event.note, actor: event.actor });
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
