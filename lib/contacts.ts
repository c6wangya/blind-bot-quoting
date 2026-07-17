import type { Contact } from "./types";

// Additional order-confirmation recipients ("contacts"). Kept small and pure so both the DB layer
// (sanitize on write) and the email layer (resolve recipients on send) can share it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CONTACTS = 20;

/** Coerce arbitrary request JSON into a clean Contact[] — valid emails only, deduped, capped. */
export function sanitizeContacts(v: unknown): Contact[] {
  if (!Array.isArray(v)) return [];
  const out: Contact[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const email = String((item as { email?: unknown }).email ?? "").trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    const name = String((item as { name?: unknown }).name ?? "").trim().slice(0, 200) || null;
    out.push({ name, email });
    if (out.length >= MAX_CONTACTS) break;
  }
  return out;
}

/** Every recipient for a quote's order confirmation: primary customer email + contacts, deduped. */
export function recipientEmails(
  customerEmail: string | null | undefined,
  contacts: Contact[] | null | undefined
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (e: unknown) => {
    const v = String(e ?? "").trim().toLowerCase();
    if (v && EMAIL_RE.test(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  add(customerEmail);
  for (const c of contacts ?? []) add(c.email);
  return out;
}
