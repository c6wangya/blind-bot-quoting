import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type { QuoteItemRow } from "@/lib/types";
import type { WindowQuoteComputation, WindowQuoteConfig } from "@/lib/window/quote";
import { ITEM_COLS } from "./internal";

/**
 * Insert a window-product quote line. line_id='window-product' (a new kind — existing
 * accessory/roller/drapery branches never see it); product_id stores the catalog_products id
 * as text for display-time lookups, but the snapshot carries everything rendering needs.
 */
/** The quote's window ship method ('ground' default; matches freight_rules.method). Own select —
 *  never part of QUOTE_COLS, so live non-window reads are deploy-order independent. */
export async function getWindowShipMethod(quoteId: number, sb: SupabaseClient = admin()): Promise<string> {
  const { data } = await sb.from("quotes").select("window_ship_method").eq("id", quoteId).maybeSingle();
  return (data as { window_ship_method?: string } | null)?.window_ship_method ?? "ground";
}

export async function setWindowShipMethod(
  quoteId: number,
  method: string,
  sb: SupabaseClient = admin()
): Promise<void> {
  const { error } = await sb.from("quotes").update({ window_ship_method: method }).eq("id", quoteId);
  if (error) throw error;
}

export async function addWindowQuoteItem(
  quoteId: number,
  productId: number,
  config: WindowQuoteConfig,
  qty: number,
  computation: WindowQuoteComputation,
  sb: SupabaseClient = admin()
): Promise<QuoteItemRow> {
  const { data, error } = await sb
    .from("quote_items")
    .insert({
      quote_id: quoteId,
      product_id: String(productId),
      line_id: "window-product",
      qty,
      config,
      computation,
    })
    .select(ITEM_COLS)
    .single();
  if (error) throw error;
  await sb.from("quotes").update({ updated_at: new Date().toISOString() }).eq("id", quoteId);
  return data as unknown as QuoteItemRow;
}
