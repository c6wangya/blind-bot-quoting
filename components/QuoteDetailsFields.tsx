"use client";

import type { Contact, QuoteDetails } from "@/lib/types";
import { cx } from "./ui";

const INPUT =
  "w-full rounded-lg border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink";

export type QuoteDetailsErrors = Partial<Record<keyof QuoteDetails, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

/** A US phone is valid when it has 10 digits (a leading country-code 1 is tolerated). */
export function isUsPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10;
}

/** True when a contact module is fully valid: name present, phone a valid US number, and at least
 *  one email row where EVERY email entered is a valid address (no blank/garbage rows tolerated). */
export function isContactValid(c: Contact): boolean {
  const emails = c.emails ?? [];
  return (
    (c.name ?? "").trim().length > 0 &&
    isUsPhone(c.phone ?? "") &&
    emails.length > 0 &&
    emails.every((e) => EMAIL_RE.test(e.trim()))
  );
}

/** Fields enforced when validation is on: Customer (all) + Ship-to (all but address line 2).
 *  With `requireContact`, contacts are optional (the customer email is always notified), but any
 *  contact that IS added must be complete — name + valid phone + valid email(s). Used at checkout. */
export function validateQuoteDetails(
  d: QuoteDetails,
  opts: { requireContact?: boolean } = {}
): QuoteDetailsErrors {
  const e: QuoteDetailsErrors = {};
  const has = (k: keyof QuoteDetails) => String(d[k] ?? "").trim().length > 0;
  const req = (k: keyof QuoteDetails) => {
    if (!has(k)) e[k] = "Required";
  };

  req("customerName");
  if (!has("customerPhone")) e.customerPhone = "Required";
  else if (!isUsPhone(String(d.customerPhone))) e.customerPhone = "Enter a 10-digit US phone number";
  if (!has("customerEmail")) e.customerEmail = "Required";
  else if (!EMAIL_RE.test(String(d.customerEmail).trim())) e.customerEmail = "Enter a valid email address";
  // Extra customer emails are optional, but every one entered must be valid (no blank rows).
  if ((d.customerEmails ?? []).some((em) => !EMAIL_RE.test(em.trim())))
    e.customerEmails = "Enter a valid email in every field, or remove the empty ones";
  req("projectName");

  if (opts.requireContact) {
    const list = d.contacts ?? [];
    if (list.length && !list.every(isContactValid))
      e.contacts = "Complete every contact — name, a 10-digit US phone, and a valid address in every email field";
  }

  req("shipAddress1");
  req("shipCity");
  req("shipState");
  if (!has("shipZip")) e.shipZip = "Required";
  else if (!ZIP_RE.test(String(d.shipZip).trim())) e.shipZip = "Enter a valid ZIP code";

  return e;
}

/** The order-critical quote header fields — customer, project, ship-to, references.
 *  Pass `errors` + `showRequired` to surface validation (see validateQuoteDetails). */
export function QuoteDetailsFields({
  value,
  onChange,
  errors,
  showRequired = false,
}: {
  value: QuoteDetails;
  onChange: (next: QuoteDetails) => void;
  errors?: QuoteDetailsErrors;
  showRequired?: boolean;
}) {
  const set = (k: keyof QuoteDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const v = (k: keyof QuoteDetails) => (value[k] as string | null | undefined) ?? "";
  const err = (k: keyof QuoteDetails) => errors?.[k];
  const cls = (k: keyof QuoteDetails) => cx(INPUT, err(k) ? "border-red-400 focus:border-red-500" : "border-line");

  // The primary customer can carry several emails: the first (customerEmail) is required, the rest
  // (customerEmails) are optional extras — all receive the order confirmation.
  const customerEmails: string[] = value.customerEmails ?? [];
  const setCustomerEmails = (next: string[]) => onChange({ ...value, customerEmails: next });
  const updateCustomerEmail = (k: number, val: string) =>
    setCustomerEmails(customerEmails.map((e, m) => (m === k ? val : e)));
  const addCustomerEmail = () => setCustomerEmails([...customerEmails, ""]);
  const removeCustomerEmail = (k: number) => setCustomerEmails(customerEmails.filter((_, m) => m !== k));
  const badCustomerEmail = (e: string) => !!err("customerEmails") && !EMAIL_RE.test(e.trim());

  // Customer contacts. At checkout they're the order-confirmation recipients (every email is sent to);
  // in the address book they're the customer's reusable contact list. Each contact = name + phone +
  // one or more emails.
  const contacts: Contact[] = value.contacts ?? [];
  const setContacts = (next: Contact[]) => onChange({ ...value, contacts: next });
  const addContact = () => setContacts([...contacts, { name: "", phone: "", emails: [""] }]);
  const updateContact = (i: number, patch: Partial<Contact>) =>
    setContacts(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeContact = (i: number) => setContacts(contacts.filter((_, j) => j !== i));
  const setEmail = (i: number, k: number, val: string) =>
    updateContact(i, { emails: contacts[i].emails.map((e, m) => (m === k ? val : e)) });
  const addEmail = (i: number) => updateContact(i, { emails: [...contacts[i].emails, ""] });
  const removeEmail = (i: number, k: number) =>
    updateContact(i, { emails: contacts[i].emails.filter((_, m) => m !== k) });

  // Only paint fields red once a validation error is showing for the contacts block.
  const showContactErr = !!err("contacts");
  const badName = (c: Contact) => showContactErr && !(c.name ?? "").trim();
  const badPhone = (c: Contact) => showContactErr && !isUsPhone(c.phone ?? "");
  const badEmail = (e: string) => showContactErr && !EMAIL_RE.test(e.trim());
  const fieldCls = (bad: boolean) => cx(INPUT, bad ? "border-red-400 focus:border-red-500" : "border-line");

  // "Add contact" lives in the Customer section header (right side) to save vertical space.
  const addContactBtn = (
    <button
      type="button"
      onClick={addContact}
      className="text-[12px] font-medium text-brass transition-colors hover:underline"
    >
      ＋ Add contact
    </button>
  );

  return (
    <div className="space-y-6">
      <Section title="References">
        <Field label="Sidemark" hint="Job/room label printed on the supplier order">
          <input className={cls("sidemark")} value={v("sidemark")} onChange={set("sidemark")} placeholder="e.g. Master Bedroom" />
        </Field>
        <Field label="PO reference">
          <input className={cls("po")} value={v("po")} onChange={set("po")} placeholder="Your purchase-order #" />
        </Field>
      </Section>

      <Section title="Customer" action={addContactBtn}>
        <Field label="Name" required={showRequired} error={err("customerName")}>
          <input className={cls("customerName")} value={v("customerName")} onChange={set("customerName")} placeholder="Customer name" />
        </Field>
        <Field label="Phone" required={showRequired} error={err("customerPhone")}>
          <input className={cls("customerPhone")} value={v("customerPhone")} onChange={set("customerPhone")} placeholder="+1 000 000 0000" />
        </Field>

        {/* Email — the primary address (required) plus any extras; all receive the confirmation. */}
        <div>
          <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
            Email{showRequired && <span className="text-red-500"> *</span>}
          </span>
          <div className="space-y-2">
            <input className={cls("customerEmail")} value={v("customerEmail")} onChange={set("customerEmail")} placeholder="name@email.com" type="email" />
            {customerEmails.map((em, k) => (
              <div key={k} className="flex items-center gap-2">
                <input
                  className={fieldCls(badCustomerEmail(em))}
                  value={em}
                  onChange={(e) => updateCustomerEmail(k, e.target.value)}
                  placeholder="Additional email"
                  type="email"
                />
                <button
                  type="button"
                  onClick={() => removeCustomerEmail(k)}
                  aria-label={`Remove email ${k + 1}`}
                  className="shrink-0 rounded-lg px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-[#f1efe9] hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {err("customerEmail") && <span className="mt-1 block text-[11px] text-red-500">{err("customerEmail")}</span>}
          {err("customerEmails") && <span className="mt-1 block text-[11px] text-red-500">{err("customerEmails")}</span>}
          <button
            type="button"
            onClick={addCustomerEmail}
            className="mt-1.5 text-[12px] font-medium text-brass transition-colors hover:underline"
          >
            ＋ Add email
          </button>
        </div>

        {/* Additional contacts (optional) — sit right under the customer so the "Add contact" header
            button and the cards it creates stay visually together. */}
        {contacts.length > 0 && (
          <div className="space-y-3 border-t border-line/70 pt-4">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Additional contacts
            </span>
            {contacts.map((c, i) => (
              <div key={i} className="rounded-xl border border-line bg-[#faf9f6] p-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Contact {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeContact(i)}
                    aria-label={`Remove contact ${i + 1}`}
                    className="rounded-lg px-1.5 py-0.5 text-[12px] text-muted transition-colors hover:bg-[#f1efe9] hover:text-red-600"
                  >
                    ✕ Remove
                  </button>
                </div>
                <div className="space-y-2.5">
                  <div>
                    <span className="mb-1 block text-[11px] font-medium text-ink-soft">Name <span className="text-red-500">*</span></span>
                    <input
                      className={fieldCls(badName(c))}
                      value={c.name ?? ""}
                      onChange={(e) => updateContact(i, { name: e.target.value })}
                      placeholder="Contact name"
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-[11px] font-medium text-ink-soft">Phone <span className="text-red-500">*</span></span>
                    <input
                      className={fieldCls(badPhone(c))}
                      value={c.phone ?? ""}
                      onChange={(e) => updateContact(i, { phone: e.target.value })}
                      placeholder="+1 000 000 0000"
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-[11px] font-medium text-ink-soft">Email <span className="text-red-500">*</span></span>
                    <div className="space-y-2">
                      {c.emails.map((em, k) => (
                        <div key={k} className="flex items-center gap-2">
                          <input
                            className={fieldCls(badEmail(em))}
                            value={em}
                            onChange={(e) => setEmail(i, k, e.target.value)}
                            placeholder="name@email.com"
                            type="email"
                          />
                          {c.emails.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeEmail(i, k)}
                              aria-label={`Remove email ${k + 1}`}
                              className="shrink-0 rounded-lg px-2 py-1.5 text-[13px] text-muted transition-colors hover:bg-[#f1efe9] hover:text-red-600"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => addEmail(i)}
                      className="mt-1.5 text-[12px] font-medium text-brass transition-colors hover:underline"
                    >
                      ＋ Add email
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {err("contacts") && <span className="block text-[11px] text-red-500">{err("contacts")}</span>}
          </div>
        )}

        <Field label="Project name" required={showRequired} error={err("projectName")}>
          <input className={cls("projectName")} value={v("projectName")} onChange={set("projectName")} placeholder="e.g. Maple St. — Unit 4B" />
        </Field>
      </Section>

      <Section title="Ship to">
        <Field label="Address line 1" required={showRequired} error={err("shipAddress1")}>
          <input className={cls("shipAddress1")} value={v("shipAddress1")} onChange={set("shipAddress1")} placeholder="Street address" />
        </Field>
        <Field label="Address line 2">
          <input className={cls("shipAddress2")} value={v("shipAddress2")} onChange={set("shipAddress2")} placeholder="Apartment, suite, building… (optional)" />
        </Field>
        <div className="grid grid-cols-[1fr_90px_110px] gap-3">
          <Field label="City" required={showRequired} error={err("shipCity")}>
            <input className={cls("shipCity")} value={v("shipCity")} onChange={set("shipCity")} placeholder="City" />
          </Field>
          <Field label="State" required={showRequired} error={err("shipState")}>
            <input className={cls("shipState")} value={v("shipState")} onChange={set("shipState")} placeholder="State" />
          </Field>
          <Field label="ZIP" required={showRequired} error={err("shipZip")}>
            <input className={cls("shipZip")} value={v("shipZip")} onChange={set("shipZip")} placeholder="ZIP" />
          </Field>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</span>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-red-500">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>
      )}
    </label>
  );
}
