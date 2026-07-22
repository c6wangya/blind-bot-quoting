import type { SupabaseClient } from "@supabase/supabase-js";
import { ACCESSORY_PRICING_VERSION, type AccessoryModel } from "@/lib/accessories-data";
import { admin } from "@/lib/supabase/admin";
import { loadCatalog } from "./accessory-catalog";
import type {
  AccessoryConfig,
  AdjustmentConfig,
  ItemConfig,
  Product,
  QuoteComputation,
  QuoteDetails,
  QuoteItemRow,
  QuoteRow,
  VariationSnapshot,
} from "@/lib/types";
import { isAccessoryConfig } from "@/lib/types";
import { sanitizeContacts, sanitizeEmails } from "@/lib/contacts";
import { ITEM_COLS, QUOTE_COLS, round2, insertWithRef } from "./internal";
import { DEMO_RETAILER, ensureSeeded } from "./seed";
import { getProfile, getRetailerDiscount, getShippingWaivers } from "./profile";
import { restoreMotorStock, motorNeedsOf } from "./motors";
import { getVariationItemModelMap } from "./variations";
import { computeShipping, type MotorRate } from "@/lib/shipping";

/**
 * The retailer display name snapshotted onto a quote (and inherited by its order): the owner's
 * company, else their email. Falls back to the demo label only when the profile can't be read.
 */
async function retailerNameFor(ownerId: string): Promise<string> {
  const profile = await getProfile(ownerId).catch(() => null);
  return profile?.company?.trim() || profile?.email || DEMO_RETAILER;
}

// Map camelCase QuoteDetails → snake_case columns; only keys actually present are written.
const DETAIL_KEYS: (keyof QuoteDetails)[] = [
  "quoteType", "quoteName", "projectName", "customerName", "customerPhone", "customerEmail",
  "customerEmails", "shipAddress1", "shipAddress2", "shipCity", "shipState", "shipZip", "po",
  "sidemark", "contacts",
];
const COLUMN: Record<keyof QuoteDetails, string> = {
  quoteType: "quote_type", quoteName: "quote_name", projectName: "project_name", customerName: "customer_name",
  customerPhone: "customer_phone", customerEmail: "customer_email", customerEmails: "customer_emails",
  shipAddress1: "ship_address1", shipAddress2: "ship_address2", shipCity: "ship_city",
  shipState: "ship_state", shipZip: "ship_zip", po: "po", sidemark: "sidemark", contacts: "contacts",
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
    if (k === "contacts" || k === "customerEmails") continue; // jsonb arrays — sanitized below
    if (k in o) {
      const v = o[k];
      (out as Record<string, unknown>)[k] = v == null || v === "" ? null : String(v).slice(0, 500);
    }
  }
  if ("customerEmails" in o) out.customerEmails = sanitizeEmails(o.customerEmails);
  if ("contacts" in o) out.contacts = sanitizeContacts(o.contacts);
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

export async function getDraftCount(ownerId: string, sb: SupabaseClient = admin()): Promise<number> {
  await ensureSeeded();
  const { count, error } = await sb
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .eq("status", "draft")
    .eq("owner_id", ownerId);
  if (error) throw error;
  return count ?? 0;
}

export async function getOrCreateDraftQuote(
  ownerId: string,
  projectName?: string,
  sb: SupabaseClient = admin()
): Promise<QuoteRow> {
  const existing = await getDraftQuote(ownerId, sb);
  if (existing) return existing;
  const retailer = await retailerNameFor(ownerId);
  return insertWithRef("quotes", "Q", async (ref) => {
    const { data, error } = await sb
      .from("quotes")
      .insert({ ref, retailer, status: "draft", owner_id: ownerId, project_name: projectName ?? null })
      .select(QUOTE_COLS)
      .single();
    if (error) throw error;
    return data as unknown as QuoteRow;
  });
}

/** Create a new draft quote with header details (the "Create new quote" flow). */
export async function createQuote(
  ownerId: string,
  details: QuoteDetails = {},
  sb: SupabaseClient = admin()
): Promise<QuoteRow> {
  await ensureSeeded();
  const retailer = await retailerNameFor(ownerId);
  return insertWithRef("quotes", "Q", async (ref) => {
    const { data, error } = await sb
      .from("quotes")
      .insert({ ref, retailer, status: "draft", owner_id: ownerId, ...detailColumns(details) })
      .select(QUOTE_COLS)
      .single();
    if (error) throw error;
    return data as unknown as QuoteRow;
  });
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

/** Update an existing quote line (re-configured product, or just a qty change). */
export async function updateQuoteItem(
  itemId: number,
  patch: { config?: ItemConfig | AccessoryConfig | AdjustmentConfig; computation?: QuoteComputation; qty?: number },
  sb: SupabaseClient = admin()
): Promise<void> {
  const cols: Record<string, unknown> = {};
  if (patch.config !== undefined) cols.config = patch.config;
  if (patch.computation !== undefined) cols.computation = patch.computation;
  if (patch.qty !== undefined) cols.qty = patch.qty;
  if (Object.keys(cols).length === 0) return;
  const { data, error } = await sb.from("quote_items").update(cols).eq("id", itemId).select("quote_id").single();
  if (error) throw error;
  await sb
    .from("quotes")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", (data as { quote_id: number }).quote_id);
}

/**
 * Delete a quote and everything that hangs off it. Children are removed before the parent because
 * the FKs aren't cascade (see `scripts/delete-demo-data.mjs`):
 *   order_events → orders → quote_items → quotes.
 * When the quote has been converted, this PERMANENTLY deletes the resulting order + its status
 * history too. The order rows are removed with `admin()` (service_role) regardless of `sb`, because
 * RLS `orders_delete` only allows admins — ownership has already been verified by the API gate, so
 * bypassing RLS for the cascade is safe. `messages.quote_id` is `on delete set null` (migration
 * 0020), so chat history survives with a null link.
 */
export async function deleteQuote(quoteId: number, sb: SupabaseClient = admin()): Promise<void> {
  const sbAdmin = admin();
  const { data: orders } = await sbAdmin.from("orders").select("id, status").eq("quote_id", quoteId);
  const orderRows = (orders ?? []) as { id: number; status: string }[];
  const orderIds = orderRows.map((o) => o.id);
  if (orderIds.length) {
    // An unpaid (awaiting_payment) order still HOLDS reserved motor stock that nothing has released
    // yet — hard-deleting it here (the quote shows as "draft" until paid, so it's deleted via the
    // normal draft path) would leak that reservation. Release it first, exactly like cancelOrder.
    // cancelled/refunded orders already released their stock (or intentionally kept it, post-ship);
    // paid in-pipeline orders represent committed units — none of those get restored here.
    //
    // Atomically CLAIM the unpaid order (awaiting_payment → cancelled) before restoring, and only
    // restore if we won the row. This closes the race with a concurrent markOrderPaid / cancelOrder
    // (both also flip awaiting_payment): otherwise we could restore stock for an order that just got
    // paid, or double-restore one being cancelled in parallel. The rows are deleted right after.
    const { data: claimed } = await sbAdmin
      .from("orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("quote_id", quoteId)
      .eq("status", "awaiting_payment")
      .select("id");
    if ((claimed ?? []).length) {
      const quote = await getQuote(quoteId, sbAdmin);
      // Variation-aware: releases the motor model AND every chosen sub-part's source-model stock.
      const needs = await motorNeedsOf(quote?.items ?? [], sbAdmin);
      // At most one awaiting_payment order per quote (partial-unique index), so restore once.
      if (needs.length) await restoreMotorStock(needs, sbAdmin);
    }
    await sbAdmin.from("order_events").delete().in("order_id", orderIds);
    const { error: oErr } = await sbAdmin.from("orders").delete().in("id", orderIds);
    if (oErr) throw oErr;
  }
  await sb.from("quote_items").delete().eq("quote_id", quoteId);
  const { error } = await sb.from("quotes").delete().eq("id", quoteId);
  if (error) throw error;
}

/**
 * Add an A-OK accessory (e.g. a motor) to a quote — fixed price, no dimensions/config.
 * Stored in the same quote_items table as full products so it flows through the same
 * quote → pre-order → Excel → tracking pipeline. lineId = "accessory".
 */
/**
 * Build the snapshot `config` + `computation` for an accessory line. Per-unit price =
 * motor base + Σ(sub-part price × its per-motor qty); the line qty multiplies it elsewhere.
 * Shared by the add and the in-quote edit (qty / sub-part qty) paths so both stay in sync.
 */
async function buildAccessoryLine(
  model: AccessoryModel,
  unitPrice: number | undefined,
  variations: VariationSnapshot[],
  componentPrices?: { motor?: number; items?: Record<string, number>; by: string; at: string },
  airFreight = false
): Promise<{ config: AccessoryConfig; computation: QuoteComputation }> {
  const cat = await loadCatalog();
  const category = cat.category(model.categoryId);
  // Resolve the model's actual brand via its category (multi-brand catalog); fall back to the
  // default brand only when the category has no brandId / the brand row is missing.
  const brandName =
    cat.brands.find((b) => b.id === category?.brandId)?.name ?? cat.brand.name;
  // Apply any admin per-component override: a custom motor base and/or per-sub-part unit price. The
  // effective sub-part price is snapshotted onto each variation so every downstream display (quote,
  // invoice, Excel, PO, chat) shows the overridden number with no extra plumbing.
  const overItems = componentPrices?.items ?? {};
  const outVariations: VariationSnapshot[] = variations.map((v) =>
    v.itemId in overItems ? { ...v, price: round2(overItems[v.itemId]) } : v
  );
  const config: AccessoryConfig = {
    kind: "accessory",
    modelId: model.id,
    sku: model.sku,
    name: model.name,
    brand: brandName,
    category: category?.name ?? model.categoryId,
    image: cat.image(model),
    ...(outVariations.length ? { variations: outVariations } : {}),
    ...(airFreight ? { airFreight: true } : {}),
  };
  // Snapshot the retailer's effective price (override → default → static), defaulting to static; an
  // admin motor-base override wins for this quote.
  const base = componentPrices?.motor ?? unitPrice ?? model.price ?? 0;
  const lines = [{ label: "Unit price", detail: model.sku, amount: base }];
  let price = base;
  for (const v of outVariations) {
    const vqty = v.qty ?? 1;
    if (v.price) {
      lines.push({
        label: v.variationName,
        detail: vqty > 1 ? `${v.itemLabel} ×${vqty}` : v.itemLabel,
        amount: round2(v.price * vqty),
      });
      price += v.price * vqty;
    }
  }
  const computation: QuoteComputation = {
    unitPrice: round2(price),
    currency: "USD",
    lines,
    facts: [
      { label: "Brand", value: brandName },
      { label: "Model #", value: model.sku },
      ...outVariations.map((v) => ({
        label: v.variationName,
        value: (v.qty ?? 1) > 1 ? `${v.itemLabel} ×${v.qty}` : v.itemLabel,
      })),
    ],
    pricingVersion: ACCESSORY_PRICING_VERSION,
    ...(componentPrices ? { componentPrices } : {}),
  };
  return { config, computation };
}

export async function addAccessoryItem(
  quoteId: number,
  model: AccessoryModel,
  qty: number,
  sb: SupabaseClient = admin(),
  unitPrice?: number,
  variations: VariationSnapshot[] = [],
  airFreight = false
): Promise<QuoteItemRow> {
  const { config, computation } = await buildAccessoryLine(model, unitPrice, variations, undefined, airFreight);
  const { data, error } = await sb
    .from("quote_items")
    .insert({ quote_id: quoteId, product_id: model.id, line_id: "accessory", qty, config, computation })
    .select(ITEM_COLS)
    .single();
  if (error) throw error;
  await sb.from("quotes").update({ updated_at: new Date().toISOString() }).eq("id", quoteId);
  return data as unknown as QuoteItemRow;
}

/**
 * Add an exchange REPLACEMENT accessory line to a quote (used by a refund-with-exchange). The
 * customer is not charged for it — its stored `computation.unitPrice` is 0 and every variation price
 * is zeroed, so it folds through all `Σ unitPrice × qty` totals as $0 and never inflates the order.
 * The real per-unit value it WOULD have cost (base + variations) is returned and also snapshotted on
 * `config.exchangeValue`, so the refund's "多退少不补" math (cash = max(0, returned − replacement))
 * and the audit trail have the true figure. Returns the new line + its real per-unit value.
 */
export async function addExchangeReplacement(
  quoteId: number,
  model: AccessoryModel,
  qty: number,
  unitPrice: number | undefined,
  variations: VariationSnapshot[],
  sb: SupabaseClient = admin()
): Promise<{ item: QuoteItemRow; unitValue: number }> {
  // Build the line at REAL prices first, to capture the true per-unit value (base + variations).
  const real = await buildAccessoryLine(model, unitPrice, variations, undefined, false);
  const unitValue = real.computation.unitPrice;
  // Zero the customer-facing price: strip every variation price and flatten the computation to $0,
  // and mark the line as an exchange with its real value preserved for the refund record.
  const config: AccessoryConfig = {
    ...real.config,
    exchange: true,
    exchangeValue: unitValue,
    ...(real.config.variations ? { variations: real.config.variations.map((v) => ({ ...v, price: 0 })) } : {}),
  };
  const computation: QuoteComputation = {
    ...real.computation,
    unitPrice: 0,
    lines: [{ label: "Exchange (no charge)", detail: model.sku, amount: 0 }],
  };
  const { data, error } = await sb
    .from("quote_items")
    .insert({ quote_id: quoteId, product_id: model.id, line_id: "accessory", qty, config, computation })
    .select(ITEM_COLS)
    .single();
  if (error) throw error;
  await sb.from("quotes").update({ updated_at: new Date().toISOString() }).eq("id", quoteId);
  return { item: data as unknown as QuoteItemRow, unitValue };
}

/**
 * Stamp an admin per-quote price override onto a freshly computed (standard) computation: `unitPrice`
 * becomes the flat `value`, and the standard price it replaces is remembered for "was $X" display.
 * `comp` must be the standard computation (no override) — the standard is read straight off it.
 */
export function applyPriceOverride(comp: QuoteComputation, value: number, by: string): QuoteComputation {
  return {
    ...comp,
    unitPrice: round2(value),
    priceOverride: { value: round2(value), standard: comp.unitPrice, by, at: new Date().toISOString() },
  };
}

/**
 * Re-price an existing accessory line after the customer edits the motor qty and/or the per-motor
 * sub-part quantities on the quote page. Re-snapshots config + computation so the stored price
 * always matches the current selection (the client preview is never trusted). Any admin per-component
 * price override (`componentPrices`) is re-applied so a special per-quote price survives a qty or
 * sub-part change — only an admin sets it, only an admin clears it.
 */
export async function updateAccessoryItem(
  itemId: number,
  model: AccessoryModel,
  qty: number,
  unitPrice: number,
  variations: VariationSnapshot[],
  sb: SupabaseClient = admin(),
  componentPrices?: { motor?: number; items?: Record<string, number>; by: string; at: string },
  airFreight = false
): Promise<void> {
  const { config, computation } = await buildAccessoryLine(model, unitPrice, variations, componentPrices, airFreight);
  await updateQuoteItem(itemId, { config, computation, qty }, sb);
}

/**
 * Set (or clear, with `value: null`) the admin per-quote price override on a line. Setting does NOT
 * re-snapshot the product — it treats the line's current standard price as the baseline, so it works
 * uniformly for product and accessory lines. Clearing restores the remembered standard price.
 * Admin-only; the API route enforces that. Returns the line's quote id (for revalidation).
 */
export async function setLinePriceOverride(
  itemId: number,
  value: number | null,
  by: string,
  sb: SupabaseClient = admin()
): Promise<number> {
  const { data, error } = await sb
    .from("quote_items")
    .select("quote_id, computation")
    .eq("id", itemId)
    .single();
  if (error) throw error;
  const row = data as { quote_id: number; computation: QuoteComputation };
  const comp = row.computation;
  const standard = comp.priceOverride?.standard ?? comp.unitPrice;
  let next: QuoteComputation;
  if (value === null) {
    // Restore the standard price and drop the override metadata.
    const { priceOverride: _drop, ...rest } = comp;
    void _drop;
    next = { ...rest, unitPrice: round2(standard) };
  } else {
    next = { ...comp, unitPrice: round2(value), priceOverride: { value: round2(value), standard: round2(standard), by, at: new Date().toISOString() } };
  }
  await updateQuoteItem(itemId, { computation: next }, sb);
  return row.quote_id;
}

/**
 * Add an admin ad-hoc money line (surcharge if positive, discount if negative) to a quote. It is not
 * a catalog product (no stock, no manufacturing); the amount sits in `computation.unitPrice` (qty 1)
 * so it folds through the same totals as every other line. Admin-only; the API route enforces that.
 */
export async function addAdjustmentLine(
  quoteId: number,
  label: string,
  amount: number,
  note: string | undefined,
  sb: SupabaseClient = admin()
): Promise<QuoteItemRow> {
  const config: AdjustmentConfig = { kind: "adjustment", label, ...(note ? { note } : {}) };
  const computation: QuoteComputation = {
    unitPrice: round2(amount),
    currency: "USD",
    lines: [{ label, amount: round2(amount) }],
    facts: [],
    pricingVersion: "adjustment",
  };
  const { data, error } = await sb
    .from("quote_items")
    .insert({ quote_id: quoteId, product_id: "adjustment", line_id: "adjustment", qty: 1, config, computation })
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
    .eq("owner_id", ownerId)
    .order("id", { ascending: false });
  if (error) throw error;
  // Full line snapshot (config + product) so each row's Total can be computed exactly like the quote
  // detail page — discounted net + shipping + admin-priced expedite — not just the raw subtotal.
  const { data: items, error: e2 } = await sb
    .from("quote_items")
    .select("quoteId:quote_id, productId:product_id, qty, config, computation");
  if (e2) throw e2;
  type Agg = {
    quoteId: number;
    productId: string;
    qty: number;
    config: ItemConfig | AccessoryConfig;
    computation: QuoteComputation;
  };
  const aggs = (items ?? []) as unknown as Agg[];

  // Owner-level inputs for the grand total (every row shares the same owner, so fetch once). All
  // best-effort: if any is unavailable the row falls back to the pre-discount subtotal.
  const [discountPct, catalog, waivers, itemModelMap] = await Promise.all([
    getRetailerDiscount(ownerId).catch(() => 0),
    loadCatalog().catch(() => null),
    getShippingWaivers(ownerId).catch(() => ({ ground: false, expedite: false })),
    getVariationItemModelMap().catch(() => ({} as Record<string, string>)),
  ]);
  // Expedite lives on the quotes table (columns, migration 0026); one batch read, best-effort so a
  // pre-migration DB just treats every quote as having no expedite.
  const expediteById: Record<number, { expedite: boolean; status: string | null; fee: number | null; sig: string | null }> = {};
  try {
    const { data: exp } = await sb
      .from("quotes")
      .select("id, expedite, expedite_status, expedite_fee, expedite_quoted_sig")
      .eq("owner_id", ownerId);
    for (const r of (exp ?? []) as Record<string, unknown>[]) {
      expediteById[r.id as number] = {
        expedite: r.expedite === true,
        status: (r.expedite_status as string) ?? null,
        fee: r.expedite_fee == null ? null : Number(r.expedite_fee),
        sig: (r.expedite_quoted_sig as string) ?? null,
      };
    }
  } catch {
    /* pre-migration — no expedite */
  }

  // variation item_id → its source model's shipping rate/mode (shared across all rows).
  const itemRates: Record<string, MotorRate> = {};
  if (catalog) {
    for (const [itemId, modelId] of Object.entries(itemModelMap)) {
      const m = catalog.model(modelId);
      if (m) itemRates[itemId] = { shipGround: m.shipGround, shipExpedite: m.shipExpedite, shipMode: m.shipMode };
    }
  }

  return ((quotes ?? []) as unknown as QuoteRow[]).map((q) => {
    const its = aggs.filter((i) => i.quoteId === q.id);
    const subtotal = round2(its.reduce((s, i) => s + (i.computation?.unitPrice ?? 0) * i.qty, 0));
    let total = subtotal;
    if (catalog) {
      // Mirror app/(portal)/quotes/[id]/page.tsx: net = subtotal − discount, + shipping, + a valid
      // (non-stale) admin-quoted expedite fee.
      const netTotal = round2(subtotal * (1 - discountPct / 100));
      const e = expediteById[q.id];
      const lineItems = its as unknown as QuoteItemRow[];
      const ship = computeShipping(lineItems, catalog, itemRates, e?.expedite === true, netTotal, waivers);
      const stale = e?.status === "quoted" && (e.sig ?? null) !== expediteSignature(its);
      const expediteFee = e?.status === "quoted" && !stale ? e.fee ?? 0 : 0;
      total = Math.max(0, round2(netTotal + ship.amount + expediteFee));
    }
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

/**
 * A quote's expedite flag (the only shipping field the customer controls — the FOB/Ground mode is
 * set per-retailer by an admin). Read separately from getQuote (not in QUOTE_COLS) so the core quote
 * read never breaks before the 0023 migration runs — falls back to false.
 */
export async function getQuoteExpedite(id: number, sb: SupabaseClient = admin()): Promise<boolean> {
  const { data, error } = await sb.from("quotes").select("expedite").eq("id", id).maybeSingle();
  if (error || !data) return false;
  return (data as { expedite: boolean | null }).expedite === true;
}

/** Set a quote's expedite flag (RLS via the caller's client). */
export async function setQuoteExpedite(id: number, expedite: boolean, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("quotes").update({ expedite: !!expedite }).eq("id", id);
  if (error) throw error;
}

// ── Admin-priced expedited shipping ("custom expedite quote", migration 0026) ────────────────────
// Distinct from the legacy `expedite` boolean above (kept intact — it drove the now-superseded
// per-line auto-accumulation). The new flow: the customer requests expedite, the admin sends one flat
// fee, and that fee is baked into the quote/order total while status = 'quoted'.
export type ExpediteStatus = "none" | "requested" | "quoted";
// sig = the content fingerprint the fee was quoted against (migration 0028). The fee is only valid
// while the live fingerprint matches; reverting an edit makes it match again → fee restored.
export type ExpediteState = { status: ExpediteStatus; fee: number | null; sig: string | null };

/**
 * Deterministic fingerprint of the quote lines the expedite fee depends on: product, qty, unit price
 * (catches any reconfiguration / price change) and each sub-part's qty. Order-independent so it's
 * stable across reads, and identical again if the customer reverts a change.
 */
export function expediteSignature(items: Pick<QuoteItemRow, "productId" | "qty" | "config" | "computation">[]): string {
  return items
    .map((it) => {
      const vars = isAccessoryConfig(it.config)
        ? (it.config.variations ?? [])
            .map((v) => `${v.itemId}x${v.qty ?? 1}`)
            .sort()
            .join(",")
        : "";
      return `${it.productId}:${it.qty}:${it.computation.unitPrice}:${vars}`;
    })
    .sort()
    .join("|");
}

/** A quote's expedite request state. Best-effort (returns 'none' before the 0026 migration runs). */
export async function getQuoteExpediteState(id: number, sb: SupabaseClient = admin()): Promise<ExpediteState> {
  const { data, error } = await sb
    .from("quotes")
    .select("expedite_status, expedite_fee, expedite_quoted_sig")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return { status: "none", fee: null, sig: null };
  const row = data as { expedite_status: string | null; expedite_fee: number | null; expedite_quoted_sig: string | null };
  const status: ExpediteStatus =
    row.expedite_status === "requested" || row.expedite_status === "quoted" ? row.expedite_status : "none";
  return { status, fee: row.expedite_fee == null ? null : Number(row.expedite_fee), sig: row.expedite_quoted_sig ?? null };
}

/** Customer asks for an expedite price → 'requested' (clears any prior fee so it's re-quoted). */
export async function requestExpedite(id: number, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("quotes").update({ expedite_status: "requested", expedite_fee: null }).eq("id", id);
  if (error) throw error;
}

/** Customer withdraws the request → back to 'none'. */
export async function cancelExpedite(id: number, sb: SupabaseClient = admin()): Promise<void> {
  const { error } = await sb.from("quotes").update({ expedite_status: "none", expedite_fee: null }).eq("id", id);
  if (error) throw error;
}

/** Admin sets the flat expedite fee → 'quoted', binding it to the current content fingerprint. */
export async function setExpediteQuote(id: number, fee: number, sig: string, sb: SupabaseClient = admin()): Promise<void> {
  const f = round2(Number(fee));
  if (!Number.isFinite(f) || f < 0) throw new Error("Enter a valid fee (0 or more).");
  const { error } = await sb
    .from("quotes")
    .update({ expedite_status: "quoted", expedite_fee: f, expedite_quoted_sig: sig })
    .eq("id", id);
  if (error) throw error;
}

/** A quote's ref (e.g. "Q-2026-0009"), or null if it doesn't exist / isn't visible to `sb`.
 *  Used to tag a chat message with the quote it's about (RLS via the caller's client). */
export async function getQuoteRef(id: number, sb: SupabaseClient = admin()): Promise<string | null> {
  const { data } = await sb.from("quotes").select("ref").eq("id", id).maybeSingle();
  return (data as { ref: string } | null)?.ref ?? null;
}

/** For the quote detail page: the order a converted quote turned into, if any. */
export async function getOrderRefByQuote(
  quoteId: number,
  sb: SupabaseClient = admin()
): Promise<{ id: number; ref: string; status: string } | undefined> {
  // A quote can have a prior cancelled order + a live one (cancel reopens the quote) — take the
  // most recent non-cancelled order. The status lets the caller tell an unpaid pre-order
  // (awaiting_payment → quote still shows as draft + "awaiting payment") from a paid one.
  const { data, error } = await sb
    .from("orders")
    .select("id, ref, status")
    .eq("quote_id", quoteId)
    .neq("status", "cancelled")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as { id: number; ref: string; status: string } | undefined;
}
