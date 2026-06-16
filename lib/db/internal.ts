import { admin } from "@/lib/supabase/admin";

// Shared internals for the lib/db submodules. NOT re-exported from the barrel (lib/db).

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Column lists with snake_case → camelCase aliases, so DB rows hydrate directly
// into the camelCase domain types (TS types + components stay unchanged).
export const PRICING_COLS = "id, lineId:line_id, version, active, note, config, createdAt:created_at";
export const QUOTE_COLS = "id, ref, retailer, status, projectName:project_name, createdAt:created_at, updatedAt:updated_at";
export const ITEM_COLS = "id, quoteId:quote_id, productId:product_id, lineId:line_id, qty, config, computation, createdAt:created_at";
export const ORDER_COLS = "id, ref, quoteId:quote_id, status, supplierOrderNo:supplier_order_no, trackingNo:tracking_no, carrier, etaDate:eta_date, createdAt:created_at, updatedAt:updated_at";
export const EVENT_COLS = "id, orderId:order_id, status, note, actor, createdAt:created_at";

export type ItemAgg = { quoteId: number; qty: number; computation: { unitPrice: number } };

function nextRefFrom(count: number, prefix: string): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(count + 1).padStart(4, "0")}`;
}

/** Next sequential ref (e.g. Q-2026-0007 / PO-2026-0003), counted across all rows → service_role. */
export async function nextRef(table: "quotes" | "orders", prefix: string): Promise<string> {
  const { count } = await admin().from(table).select("*", { count: "exact", head: true });
  return nextRefFrom(count ?? 0, prefix);
}
