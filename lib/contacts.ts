import type { Contact } from "./types";

// Additional order-confirmation recipients ("contacts"). Kept small and pure so both the DB layer
// (sanitize on write) and the email layer (resolve recipients on send) can share it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CONTACTS = 20;

const MAX_EMAILS = 10;

/** Coerce an arbitrary value into a clean list of valid, deduped, lowercased emails (capped). */
export function sanitizeEmails(v: unknown): string[] {
  const list = Array.isArray(v) ? v : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const email = String(e ?? "").trim().toLowerCase().slice(0, 200);
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= MAX_EMAILS) break;
  }
  return out;
}

/** Pull a contact's emails from either the new `emails: string[]` or the legacy `email: string`. */
function readEmails(item: object): string[] {
  const raw = (item as { emails?: unknown }).emails;
  return sanitizeEmails(Array.isArray(raw) ? raw : [(item as { email?: unknown }).email]);
}

/** Coerce arbitrary request JSON into a clean Contact[] — each keeps name, phone and its valid
 *  emails (deduped within the contact); contacts with no valid email are dropped. Capped. */
export function sanitizeContacts(v: unknown): Contact[] {
  if (!Array.isArray(v)) return [];
  const out: Contact[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const emails = readEmails(item);
    if (!emails.length) continue;
    const name = String((item as { name?: unknown }).name ?? "").trim().slice(0, 200);
    const phone = String((item as { phone?: unknown }).phone ?? "").trim().slice(0, 40);
    out.push({ name, phone, emails });
    if (out.length >= MAX_CONTACTS) break;
  }
  return out;
}

/** Every recipient for a quote's order confirmation: primary customer email + the customer's extra
 *  emails + every contact email across all contacts, deduped. */
export function recipientEmails(
  customerEmail: string | null | undefined,
  customerEmails: string[] | null | undefined,
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
  for (const e of customerEmails ?? []) add(e);
  for (const c of contacts ?? []) for (const e of c.emails ?? []) add(e);
  return out;
}
