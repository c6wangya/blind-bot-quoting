import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCESSORY_BRAND,
  ACCESSORY_PRICING_VERSION,
  getAccessoryCategory,
  type AccessoryModel,
} from "@/lib/accessories-data";
import { admin } from "@/lib/supabase/admin";
import type {
  AccessoryConfig,
  ItemConfig,
  Product,
  QuoteComputation,
  QuoteDetails,
  QuoteItemRow,
  QuoteRow,
} from "@/lib/types";
import { ITEM_COLS, QUOTE_COLS, round2, type ItemAgg, nextRef } from "./internal";
import { DEMO_RETAILER, ensureSeeded } from "./seed";

// Map camelCase QuoteDetails → snake_case columns; only keys actually present are written.
const DETAIL_KEYS: (keyof QuoteDetails)[] = [
  "quoteType", "projectName", "customerName", "customerPhone", "customerEmail",
  "shipAddress1", "shipAddress2", "shipCity", "shipState", "shipZip", "po", "sidemark",
];
const COLUMN: Record<keyof QuoteDetails, string> = {
  quoteType: "quote_type", projectName: "project_name", customerName: "customer_name",
  customerPhone: "customer_phone", customerEmail: "customer_email", shipAddress1: "ship_address1",
  shipAddress2: "ship_address2", shipCity: "ship_city", shipState: "ship_state", shipZip: "ship_zip",
  po: "po", sidemark: "sidemark",
};
function detailColumns(d: QuoteDetails): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const k of DETAIL_KEYS) if (d[k] !== undefined) c[COLUMN[k]] = d[k];
  return c;
}

/** Coerce arbitrary request JSON into a safe QuoteDetails (known keys only, string|null). */
export function sanitizeQuoteDetails(body: unknown): QuoteDetails {
  const out: QuoteDetails = {};
  if (!body || typeof body !== "object") return out;
  const o = body as Record<string, unknown>;
  for (const k of DETAIL_KEYS) {
    if (k in o) {
      const v = o[k];
      (out as Record<string, unknown>)[k] = v == null || v === "" ? null : String(v).slice(0, 500);
    }
  }
  return out;
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

/** Create a new draft quote with header details (the "Create new quote" flow). */
export async function createQuote(
  ownerId: string,
  details: QuoteDetails = {},
  sb: SupabaseClient = admin()
): Promise<QuoteRow> {
  await ensureSeeded();
  const ref = await nextRef("quotes", "Q");
  const { data, error } = await sb
    .from("quotes")
    .insert({ ref, retailer: DEMO_RETAILER, status: "draft", owner_id: ownerId, ...detailColumns(details) })
    .select(QUOTE_COLS)
    .single();
  if (error) throw error;
  return data as unknown as QuoteRow;
}

/** Update a quote's header details (customer / ship-to / references). */
export async function updateQuoteDetails(
  quoteId: number,
  details: QuoteDetails,
  sb: SupabaseClient = admin()
): Promise<void> {
  const { error } = await sb
    .from("quotes")
    .update({ ...detailColumns(details), updated_at: new Date().toISOString() })
    .eq("id", quoteId);
  if (error) throw error;
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
