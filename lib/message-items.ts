import type { CatalogSnapshot } from "@/lib/db/accessory-catalog";
import type { MessageItemRef } from "@/lib/db";
import type { QuoteItemRow } from "@/lib/types";
import { isAccessoryConfig } from "@/lib/types";
import { getLine, getProduct } from "@/lib/db";
import { describeConfig } from "@/lib/describe";

/**
 * Snapshot a quote/order's line items into the compact references shown in the support chat item
 * picker (and stored on a message). Products have no photo URL (rendered as a Swatch elsewhere), so
 * `image` is left null and the UI falls back to a placeholder.
 */
export function quoteItemsToRefs(items: QuoteItemRow[], catalog: CatalogSnapshot): MessageItemRef[] {
  const refs: MessageItemRef[] = [];
  for (const it of items) {
    if (isAccessoryConfig(it.config)) {
      const cfg = it.config;
      const model = catalog.model(it.productId);
      const image = cfg.image ?? (model ? catalog.image(model) : null);
      // The main accessory (e.g. the motor) …
      refs.push({
        name: cfg.name,
        sku: cfg.sku ?? null,
        image,
        summary: cfg.category ?? null,
        qty: it.qty,
      });
      // … plus each of its sub-parts (Crown / Drive / …) as its own selectable line, so the
      // customer can flag a specific part. Sub-parts ship per motor unit → qty × per-motor qty.
      for (const v of cfg.variations ?? []) {
        refs.push({
          name: v.itemLabel,
          sku: null,
          image,
          summary: v.variationName || null,
          qty: it.qty * (v.qty ?? 1),
          sub: true,
        });
      }
      continue;
    }
    const product = getProduct(it.productId);
    const line = product ? getLine(it.lineId as string) : null;
    if (!product || !line) {
      refs.push({ name: "Product no longer in catalog", sku: null, image: null, summary: null, qty: it.qty });
      continue;
    }
    const desc = describeConfig(line, product, it.config);
    refs.push({
      name: product.name,
      sku: null,
      image: null,
      summary: [desc.colorName, desc.opacityLabel].filter(Boolean).join(" · ") || null,
      qty: it.qty,
    });
  }
  return refs;
}
