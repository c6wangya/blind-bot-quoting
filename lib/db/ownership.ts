import { admin } from "@/lib/supabase/admin";

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
