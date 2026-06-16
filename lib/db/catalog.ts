import { PRODUCTS, PRODUCT_LINES } from "@/lib/catalog-data";
import type { Product, ProductLine } from "@/lib/types";

// Catalog accessors — static data (not in the DB).

export function getLines(): ProductLine[] {
  return PRODUCT_LINES;
}

export function getLine(lineId: string): ProductLine | undefined {
  return PRODUCT_LINES.find((l) => l.id === lineId);
}

export function getProducts(lineId?: string): Product[] {
  return lineId ? PRODUCTS.filter((p) => p.lineId === lineId) : PRODUCTS;
}

export function getProduct(productId: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === productId);
}
