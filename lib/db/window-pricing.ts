import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type {
  AccountFactor,
  DealerAccount,
  FreightRule,
  PriceGrid,
  PriceGroup,
  PriceGroupMap,
  SizeConstraint,
  SurchargeRule,
  WindowPricingData,
} from "@/lib/window/types";

// L3 commerce data. Pricing internals are RLS'd admin-only — the app reads them via the
// service role (same posture as pricing_versions) so dealers see computed net prices but
// never the grids or their factor.

const GROUP_COLS = "id, orgId:org_id, key, label";
const MAP_COLS = "id, productId:product_id, fieldKey:field_key, valueToken:value_token, priceGroupId:price_group_id";
const GRID_COLS =
  "id, priceGroupId:price_group_id, currency, widthBreaks:width_breaks, heightBreaks:height_breaks, cells, effectiveFrom:effective_from, effectiveTo:effective_to, note";
const SURCHARGE_COLS = "id, productId:product_id, label, matcher, kind, amount";
const CONSTRAINT_COLS =
  "id, productId:product_id, matcher, dimension, minValue:min_value, maxValue:max_value, message";
const DEALER_COLS = "id, orgId:org_id, name, contact, qbRef:qb_ref";
const FACTOR_COLS = "id, dealerAccountId:dealer_account_id, productId:product_id, lineKey:line_key, factor";
const FREIGHT_COLS = "id, method, label, matcher, amount, sortOrder:sort_order";

/**
 * Load everything the pure pricing engine needs for one product + dealer, filtered to
 * currently-effective rows. dealerAccountId null = admin preview (no factors loaded;
 * caller passes factorOverride=1).
 */
export async function loadWindowPricingData(
  orgId: number,
  productId: number,
  dealerAccountId: number | null
): Promise<WindowPricingData> {
  const db = admin();
  const now = new Date().toISOString();
  const effective = <T extends { effectiveTo?: string | null }>(rows: T[]) =>
    rows.filter((r) => !r.effectiveTo || r.effectiveTo > now);

  const [groups, maps, surcharges, constraints] = await Promise.all([
    db.from("price_groups").select(GROUP_COLS).eq("org_id", orgId),
    db.from("price_group_maps").select(MAP_COLS).eq("org_id", orgId).eq("product_id", productId),
    db
      .from("surcharge_rules")
      .select(SURCHARGE_COLS + ", effectiveTo:effective_to")
      .eq("org_id", orgId)
      .or(`product_id.eq.${productId},product_id.is.null`)
      .lte("effective_from", now),
    db
      .from("size_constraints")
      .select(CONSTRAINT_COLS)
      .eq("org_id", orgId)
      .or(`product_id.eq.${productId},product_id.is.null`),
  ]);
  for (const r of [groups, maps, surcharges, constraints]) if (r.error) throw r.error;

  const groupIds = ((groups.data ?? []) as unknown as PriceGroup[]).map((g) => g.id);
  const [grids, factors] = await Promise.all([
    groupIds.length
      ? db
          .from("price_grids")
          .select(GRID_COLS + ", effectiveTo:effective_to")
          .in("price_group_id", groupIds)
          .lte("effective_from", now)
      : Promise.resolve({ data: [], error: null }),
    dealerAccountId != null
      ? db
          .from("account_factors")
          .select(FACTOR_COLS + ", effectiveTo:effective_to")
          .eq("dealer_account_id", dealerAccountId)
          .lte("effective_from", now)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (grids.error) throw grids.error;
  if (factors.error) throw factors.error;

  return {
    priceGroups: (groups.data ?? []) as unknown as PriceGroup[],
    priceGroupMaps: (maps.data ?? []) as unknown as PriceGroupMap[],
    priceGrids: effective((grids.data ?? []) as unknown as (PriceGrid & { effectiveTo?: string | null })[]),
    surchargeRules: effective(
      (surcharges.data ?? []) as unknown as (SurchargeRule & { effectiveTo?: string | null })[]
    ),
    sizeConstraints: (constraints.data ?? []) as unknown as SizeConstraint[],
    factors: effective((factors.data ?? []) as unknown as (AccountFactor & { effectiveTo?: string | null })[]),
  };
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

export async function listPriceGroups(orgId: number, client: SupabaseClient = admin()): Promise<PriceGroup[]> {
  const { data, error } = await client.from("price_groups").select(GROUP_COLS).eq("org_id", orgId).order("key");
  if (error) throw error;
  return (data ?? []) as unknown as PriceGroup[];
}

export async function upsertPriceGroup(
  orgId: number,
  group: { key: string; label?: string },
  client: SupabaseClient = admin()
): Promise<PriceGroup> {
  const { data, error } = await client
    .from("price_groups")
    .upsert({ org_id: orgId, key: group.key, label: group.label ?? null }, { onConflict: "org_id,key" })
    .select(GROUP_COLS)
    .single();
  if (error) throw error;
  return data as unknown as PriceGroup;
}

/** Replace a product's fabric→group routing for one field (bulk PUT semantics). */
export async function setPriceGroupMaps(
  orgId: number,
  productId: number,
  fieldKey: string,
  entries: { valueToken: string; priceGroupId: number }[],
  client: SupabaseClient = admin()
): Promise<void> {
  const del = await client
    .from("price_group_maps")
    .delete()
    .eq("org_id", orgId)
    .eq("product_id", productId)
    .eq("field_key", fieldKey);
  if (del.error) throw del.error;
  if (!entries.length) return;
  const ins = await client.from("price_group_maps").insert(
    entries.map((e) => ({
      org_id: orgId,
      product_id: productId,
      field_key: fieldKey,
      value_token: e.valueToken,
      price_group_id: e.priceGroupId,
    }))
  );
  if (ins.error) throw ins.error;
}

/** New grid revision: closes the current effective grid and inserts the replacement. */
export async function addPriceGrid(
  orgId: number,
  grid: {
    priceGroupId: number;
    currency?: string;
    widthBreaks: number[];
    heightBreaks: number[];
    cells: (number | null)[][];
    note?: string;
    changedBy?: string;
  },
  client: SupabaseClient = admin()
): Promise<PriceGrid> {
  const now = new Date().toISOString();
  const close = await client
    .from("price_grids")
    .update({ effective_to: now })
    .eq("org_id", orgId)
    .eq("price_group_id", grid.priceGroupId)
    .is("effective_to", null);
  if (close.error) throw close.error;
  const { data, error } = await client
    .from("price_grids")
    .insert({
      org_id: orgId,
      price_group_id: grid.priceGroupId,
      currency: grid.currency ?? "USD",
      width_breaks: grid.widthBreaks,
      height_breaks: grid.heightBreaks,
      cells: grid.cells,
      effective_from: now,
      note: grid.note ?? null,
      changed_by: grid.changedBy ?? null,
    })
    .select(GRID_COLS)
    .single();
  if (error) throw error;
  return data as unknown as PriceGrid;
}

export async function listSurchargeRules(
  orgId: number,
  productId: number | null,
  client: SupabaseClient = admin()
): Promise<SurchargeRule[]> {
  let q = client.from("surcharge_rules").select(SURCHARGE_COLS).eq("org_id", orgId).is("effective_to", null);
  if (productId != null) q = q.or(`product_id.eq.${productId},product_id.is.null`);
  const { data, error } = await q.order("id");
  if (error) throw error;
  return (data ?? []) as unknown as SurchargeRule[];
}

export async function addSurchargeRule(
  orgId: number,
  rule: Omit<SurchargeRule, "id">,
  client: SupabaseClient = admin()
): Promise<SurchargeRule> {
  const { data, error } = await client
    .from("surcharge_rules")
    .insert({
      org_id: orgId,
      product_id: rule.productId ?? null,
      label: rule.label,
      matcher: rule.matcher,
      kind: rule.kind,
      amount: rule.amount,
    })
    .select(SURCHARGE_COLS)
    .single();
  if (error) throw error;
  return data as unknown as SurchargeRule;
}

export async function removeSurchargeRule(id: number, client: SupabaseClient = admin()): Promise<void> {
  // Effective-dated close, not delete — history stays auditable.
  const { error } = await client
    .from("surcharge_rules")
    .update({ effective_to: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function listSizeConstraints(
  orgId: number,
  productId: number | null,
  client: SupabaseClient = admin()
): Promise<SizeConstraint[]> {
  let q = client.from("size_constraints").select(CONSTRAINT_COLS).eq("org_id", orgId);
  if (productId != null) q = q.or(`product_id.eq.${productId},product_id.is.null`);
  const { data, error } = await q.order("id");
  if (error) throw error;
  return (data ?? []) as unknown as SizeConstraint[];
}

export async function addSizeConstraint(
  orgId: number,
  c: Omit<SizeConstraint, "id">,
  client: SupabaseClient = admin()
): Promise<SizeConstraint> {
  const { data, error } = await client
    .from("size_constraints")
    .insert({
      org_id: orgId,
      product_id: c.productId ?? null,
      matcher: c.matcher,
      dimension: c.dimension,
      min_value: c.minValue ?? null,
      max_value: c.maxValue ?? null,
      message: c.message ?? null,
    })
    .select(CONSTRAINT_COLS)
    .single();
  if (error) throw error;
  return data as unknown as SizeConstraint;
}

export async function removeSizeConstraint(id: number, client: SupabaseClient = admin()): Promise<void> {
  const { error } = await client.from("size_constraints").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Dealer accounts + factors
// ---------------------------------------------------------------------------

export async function listDealerAccounts(orgId: number, client: SupabaseClient = admin()): Promise<DealerAccount[]> {
  const { data, error } = await client.from("dealer_accounts").select(DEALER_COLS).eq("org_id", orgId).order("name");
  if (error) throw error;
  return (data ?? []) as unknown as DealerAccount[];
}

export async function createDealerAccount(
  orgId: number,
  account: { name: string; contact?: Record<string, unknown>; qbRef?: string },
  client: SupabaseClient = admin()
): Promise<DealerAccount> {
  const { data, error } = await client
    .from("dealer_accounts")
    .insert({ org_id: orgId, name: account.name, contact: account.contact ?? {}, qb_ref: account.qbRef ?? null })
    .select(DEALER_COLS)
    .single();
  if (error) throw error;
  return data as unknown as DealerAccount;
}

export async function listAccountFactors(
  dealerAccountId: number,
  client: SupabaseClient = admin()
): Promise<AccountFactor[]> {
  const { data, error } = await client
    .from("account_factors")
    .select(FACTOR_COLS)
    .eq("dealer_account_id", dealerAccountId)
    .is("effective_to", null)
    .order("id");
  if (error) throw error;
  return (data ?? []) as unknown as AccountFactor[];
}

/** Set (or replace) a factor at one scope: product, lineKey, or blanket (both null). */
export async function setAccountFactor(
  orgId: number,
  f: { dealerAccountId: number; productId?: number | null; lineKey?: string | null; factor: number },
  client: SupabaseClient = admin()
): Promise<AccountFactor> {
  const now = new Date().toISOString();
  let close = client
    .from("account_factors")
    .update({ effective_to: now })
    .eq("dealer_account_id", f.dealerAccountId)
    .is("effective_to", null);
  close = f.productId != null ? close.eq("product_id", f.productId) : close.is("product_id", null);
  close = f.lineKey != null ? close.eq("line_key", f.lineKey) : close.is("line_key", null);
  const closed = await close;
  if (closed.error) throw closed.error;

  const { data, error } = await client
    .from("account_factors")
    .insert({
      org_id: orgId,
      dealer_account_id: f.dealerAccountId,
      product_id: f.productId ?? null,
      line_key: f.lineKey ?? null,
      factor: f.factor,
      effective_from: now,
    })
    .select(FACTOR_COLS)
    .single();
  if (error) throw error;
  return data as unknown as AccountFactor;
}

// ---------------------------------------------------------------------------
// Freight
// ---------------------------------------------------------------------------

export async function listFreightRules(orgId: number, client: SupabaseClient = admin()): Promise<FreightRule[]> {
  const { data, error } = await client
    .from("freight_rules")
    .select(FREIGHT_COLS)
    .eq("org_id", orgId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as unknown as FreightRule[];
}
