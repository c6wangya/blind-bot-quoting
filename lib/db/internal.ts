import { admin } from "@/lib/supabase/admin";

// Shared internals for the lib/db submodules. NOT re-exported from the barrel (lib/db).

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Column lists with snake_case → camelCase aliases, so DB rows hydrate directly
// into the camelCase domain types (TS types + components stay unchanged).
export const PRICING_COLS = "id, lineId:line_id, version, active, note, config, createdAt:created_at";
export const QUOTE_COLS =
  "id, ref, retailer, status, ownerId:owner_id, projectName:project_name, quoteType:quote_type, " +
  "customerName:customer_name, customerPhone:customer_phone, customerEmail:customer_email, " +
  "shipAddress1:ship_address1, shipAddress2:ship_address2, shipCity:ship_city, shipState:ship_state, shipZip:ship_zip, " +
  "po, sidemark, createdAt:created_at, updatedAt:updated_at";
export const ITEM_COLS = "id, quoteId:quote_id, productId:product_id, lineId:line_id, qty, config, computation, createdAt:created_at";
export const ORDER_COLS = "id, ref, quoteId:quote_id, status, supplierOrderNo:supplier_order_no, trackingNo:tracking_no, carrier, etaDate:eta_date, paymentMethod:payment_method, paymentStatus:payment_status, paymentRef:payment_ref, amount, discountPct:discount_pct, paidAt:paid_at, paymentProofPath:payment_proof_path, createdAt:created_at, updatedAt:updated_at";
export const EVENT_COLS = "id, orderId:order_id, status, note, actor, createdAt:created_at";

export type ItemAgg = { quoteId: number; qty: number; computation: { unitPrice: number } };

/**
 * Pure: next ref for `prefix`+`year` given the refs that already exist.
 * Uses the MAX existing sequence number (+1), NOT the row count — counting breaks the moment a
 * row is deleted (count drops below the highest number in use, so count+1 re-mints a live ref and
 * trips the `ref` unique constraint). Refs that don't match the current prefix/year are ignored,
 * so each year starts a fresh 0001 series.
 */
export function nextRefFrom(existing: string[], prefix: string, year: number): string {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let max = 0;
  for (const ref of existing) {
    const m = re.exec(ref);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Next sequential ref (e.g. Q-2026-0007 / PO-2026-0003), from the max in-use ref → service_role
 * (must see refs across all owners, so it can't run under a retailer's RLS view). Reads the single
 * lexically-largest ref via DB ordering — refs are zero-padded to 4 digits, so lexical order equals
 * numeric order up to 9999/prefix/year, which also dodges PostgREST's default 1000-row read cap.
 */
export async function nextRef(table: "quotes" | "orders", prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const { data } = await admin()
    .from(table)
    .select("ref")
    .like("ref", `${prefix}-${year}-%`)
    .order("ref", { ascending: false })
    .limit(1);
  const refs = ((data ?? []) as { ref: string | null }[]).map((r) => r.ref ?? "");
  return nextRefFrom(refs, prefix, year);
}

/** Postgres unique-violation (e.g. a concurrent insert grabbed the same ref first). */
function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "23505";
}

/**
 * Insert a row carrying a generated `ref`, retrying on a `ref` unique-violation. `nextRef` removes
 * the delete-gap collision; the retry closes the remaining concurrency window (two inserts reading
 * the same max before either commits). `build` must perform the insert with the given ref and throw
 * on DB error (Supabase returns errors, so call sites do `if (error) throw error`).
 */
export async function insertWithRef<T>(
  table: "quotes" | "orders",
  prefix: string,
  build: (ref: string) => Promise<T>,
  attempts = 5
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const ref = await nextRef(table, prefix);
    try {
      return await build(ref);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      lastErr = e; // ref clash — recompute the max and retry
    }
  }
  throw lastErr;
}
