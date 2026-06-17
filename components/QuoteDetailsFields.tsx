"use client";

import type { QuoteDetails } from "@/lib/types";

const INPUT =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink";

/** The order-critical quote header fields — customer, project, ship-to, references. */
export function QuoteDetailsFields({
  value,
  onChange,
}: {
  value: QuoteDetails;
  onChange: (next: QuoteDetails) => void;
}) {
  const set = (k: keyof QuoteDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const v = (k: keyof QuoteDetails) => (value[k] as string | null | undefined) ?? "";

  return (
    <div className="space-y-6">
      <Section title="References">
        <Field label="Sidemark" hint="Job/room label printed on the supplier order">
          <input className={INPUT} value={v("sidemark")} onChange={set("sidemark")} placeholder="e.g. Master Bedroom" />
        </Field>
        <Field label="PO reference">
          <input className={INPUT} value={v("po")} onChange={set("po")} placeholder="Your purchase-order #" />
        </Field>
      </Section>

      <Section title="Customer">
        <Field label="Name">
          <input className={INPUT} value={v("customerName")} onChange={set("customerName")} placeholder="Customer name" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input className={INPUT} value={v("customerPhone")} onChange={set("customerPhone")} placeholder="+1 000 000 0000" />
          </Field>
          <Field label="Email">
            <input className={INPUT} value={v("customerEmail")} onChange={set("customerEmail")} placeholder="name@email.com" />
          </Field>
        </div>
        <Field label="Project name">
          <input className={INPUT} value={v("projectName")} onChange={set("projectName")} placeholder="e.g. Maple St. — Unit 4B" />
        </Field>
      </Section>

      <Section title="Ship to">
        <Field label="Address line 1">
          <input className={INPUT} value={v("shipAddress1")} onChange={set("shipAddress1")} placeholder="Street address" />
        </Field>
        <Field label="Address line 2">
          <input className={INPUT} value={v("shipAddress2")} onChange={set("shipAddress2")} placeholder="Apartment, suite, building… (optional)" />
        </Field>
        <div className="grid grid-cols-[1fr_90px_110px] gap-3">
          <Field label="City">
            <input className={INPUT} value={v("shipCity")} onChange={set("shipCity")} placeholder="City" />
          </Field>
          <Field label="State">
            <input className={INPUT} value={v("shipState")} onChange={set("shipState")} placeholder="State" />
          </Field>
          <Field label="ZIP">
            <input className={INPUT} value={v("shipZip")} onChange={set("shipZip")} placeholder="ZIP" />
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}
