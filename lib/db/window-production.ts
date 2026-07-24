import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { DeductionRow } from "@/lib/window/production";

// Phase B — deduction tables (manufacturing cut offsets). Admin-only surface; MO pages read
// via service role like the other pricing internals.

const DEDUCTION_COLS =
  "id, lineKey:line_key, label, matcher, components, parts, sortOrder:sort_order, note, effectiveTo:effective_to";

export async function listDeductionRows(
  orgId: number,
  lineKey?: string,
  client: SupabaseClient = admin()
): Promise<DeductionRow[]> {
  let q = client.from("deduction_tables").select(DEDUCTION_COLS).eq("org_id", orgId).is("effective_to", null);
  if (lineKey) q = q.eq("line_key", lineKey);
  const { data, error } = await q.order("sort_order").order("id");
  if (error) throw error;
  return (data ?? []) as unknown as DeductionRow[];
}

export async function addDeductionRow(
  orgId: number,
  row: Omit<DeductionRow, "id">,
  client: SupabaseClient = admin()
): Promise<DeductionRow> {
  const { data, error } = await client
    .from("deduction_tables")
    .insert({
      org_id: orgId,
      line_key: row.lineKey,
      label: row.label,
      matcher: row.matcher,
      components: row.components,
      parts: row.parts ?? [],
      sort_order: row.sortOrder,
      note: row.note ?? null,
    })
    .select(DEDUCTION_COLS)
    .single();
  if (error) throw error;
  return data as unknown as DeductionRow;
}

/** Replace a row's offsets: effective-dated close + reinsert (history stays auditable —
 *  the anchor factory's Log sheets exist precisely because these values change monthly). */
export async function reviseDeductionRow(
  orgId: number,
  id: number,
  patch: { components?: DeductionRow["components"]; parts?: DeductionRow["parts"]; label?: string; note?: string },
  client: SupabaseClient = admin()
): Promise<DeductionRow> {
  const { data: current, error: readErr } = await client
    .from("deduction_tables")
    .select(DEDUCTION_COLS + ", orgId:org_id")
    .eq("id", id)
    .single();
  if (readErr) throw readErr;
  const cur = current as unknown as DeductionRow & { orgId: number };
  if (cur.orgId !== orgId) throw new Error("Not found");

  const now = new Date().toISOString();
  const close = await client.from("deduction_tables").update({ effective_to: now }).eq("id", id);
  if (close.error) throw close.error;
  return addDeductionRow(orgId, {
    lineKey: cur.lineKey,
    label: patch.label ?? cur.label,
    matcher: cur.matcher,
    components: patch.components ?? cur.components,
    parts: patch.parts ?? cur.parts,
    sortOrder: cur.sortOrder,
    note: patch.note ?? cur.note,
  }, client);
}

export async function removeDeductionRow(orgId: number, id: number, client: SupabaseClient = admin()): Promise<void> {
  const { error } = await client
    .from("deduction_tables")
    .update({ effective_to: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) throw error;
}
