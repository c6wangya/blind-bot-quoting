// Client-only: a product/accessory the user chose to add before a target quote was
// decided. Stashed in sessionStorage so it survives the redirect to /quotes/new (pick or
// create a quote), then replayed into the chosen quote. Survives a login bounce too.

export type PendingCrownDriver =
  | { mode: "not-needed" }
  | { mode: "crown-driver"; crownId: string; driverId: string };

export type PendingItem =
  | { kind: "product"; productId: string; lineId: string; config: unknown; qty: number }
  | { kind: "accessory"; productId: string; qty: number; crownDriver?: PendingCrownDriver };

const KEY = "pendingQuoteItem";

export function stashPendingItem(item: PendingItem): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(item));
  } catch {
    /* ignore (private mode / disabled storage) */
  }
}

export function readPendingItem(): PendingItem | null {
  try {
    const s = sessionStorage.getItem(KEY);
    return s ? (JSON.parse(s) as PendingItem) : null;
  } catch {
    return null;
  }
}

export function clearPendingItem(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Build the /api/quote-items POST body for a pending item targeting a specific quote. */
export function pendingItemBody(item: PendingItem, quoteId: number) {
  return item.kind === "product"
    ? { productId: item.productId, config: item.config, qty: item.qty, quoteId }
    : { productId: item.productId, qty: item.qty, quoteId, crownDriver: item.crownDriver };
}
