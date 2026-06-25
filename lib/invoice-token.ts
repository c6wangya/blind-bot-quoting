// THE-772 — public "pay-by-link" tokens for invoices. An invoice link can be shared with the payer
// (e.g. embedded in the downloaded PDF) so they can view + pay WITHOUT a portal login. Access is
// granted by an unguessable HMAC bound to the specific quote id — never a sequential/guessable id —
// so only someone the link was deliberately given to can open it. The amount is always recomputed
// server-side from the quote, so a token never lets anyone change what is owed, only pay it.
import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC secret. Reuses the handoff secret when a dedicated one isn't set (both are server-only). */
function secret(): string {
  return process.env.INVOICE_LINK_SECRET ?? process.env.QUOTE_HANDOFF_SECRET ?? "";
}

/** Stable (non-expiring) share token for a quote's invoice — so a link printed into a PDF keeps
 *  working. Returns "" when no secret is configured (public links simply won't verify then). */
export function signInvoiceToken(quoteId: number): string {
  const s = secret();
  if (!s) return "";
  return createHmac("sha256", s).update(`invoice:${quoteId}`).digest("base64url").slice(0, 24);
}

/** Constant-time check that `token` is the valid share token for `quoteId`. */
export function verifyInvoiceToken(quoteId: number, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = signInvoiceToken(quoteId);
  if (!expected || expected.length !== token.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}
