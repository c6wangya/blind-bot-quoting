"use client";

import type { QuoteDetails } from "@/lib/types";
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

/** Fields enforced when validation is on: Customer (all) + Ship-to (all but address line 2). */
export function validateQuoteDetails(d: QuoteDetails): QuoteDetailsErrors {
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
  req("projectName");

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

      <Section title="Customer">
        <Field label="Name" required={showRequired} error={err("customerName")}>
          <input className={cls("customerName")} value={v("customerName")} onChange={set("customerName")} placeholder="Customer name" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" required={showRequired} error={err("customerPhone")}>
            <input className={cls("customerPhone")} value={v("customerPhone")} onChange={set("customerPhone")} placeholder="+1 000 000 0000" />
          </Field>
          <Field label="Email" required={showRequired} error={err("customerEmail")}>
            <input className={cls("customerEmail")} value={v("customerEmail")} onChange={set("customerEmail")} placeholder="name@email.com" />
          </Field>
        </div>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</div>
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
