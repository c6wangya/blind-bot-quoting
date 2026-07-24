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
