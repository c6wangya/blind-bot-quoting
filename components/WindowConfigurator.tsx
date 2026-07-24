"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { evalCondition } from "@/lib/window/conditions";
import { effectiveSelections } from "@/lib/window/validate";
import { formatInches } from "@/lib/window/quote";
import type {
  FieldPolicy,
  TemplateField,
  ValidationIssue,
  WindowComputation,
  WindowProduct,
  WindowTemplate,
} from "@/lib/window/types";
import { Button, Card, Input, Select, cx } from "./ui";

// Template-driven configurator: sections & fields come from the template, offered values from
// the product's policies, visibility from visibleWhen over the effective config. The server is
// the authority — this only mirrors the same pure validation for instant feedback; every price
// shown comes from POST /api/window/price (client never computes money).

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type Props = {
  product: WindowProduct;
  template: WindowTemplate;
  dealers: { id: number; name: string }[];
};

export default function WindowConfigurator({ product, template, dealers }: Props) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, unknown>>({});
  const [widthIn, setWidthIn] = useState("36");
  const [heightIn, setHeightIn] = useState("60");
  const [room, setRoom] = useState("");
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState(1);
  const [dealerAccountId, setDealerAccountId] = useState(0);
  const [price, setPrice] = useState<WindowComputation | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [pricing, setPricing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const effective = useMemo(
    () => effectiveSelections(template, product, selections),
    [template, product, selections]
  );

  const issueFor = (key: string) => issues.find((i) => i.fieldKey === key);
  const lineIssues = issues.filter((i) => !i.fieldKey);

  // Live price — debounced; server re-validates and re-prices on every change.
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    const w = Number(widthIn);
    const h = Number(heightIn);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    const body = {
      productId: product.id,
      templateRevision: product.templateRevision,
      widthIn: w,
      heightIn: h,
      selections,
      ...(dealerAccountId ? { dealerAccountId } : {}),
    };
    const t = setTimeout(async () => {
      if (my !== seq.current) return;
      setPricing(true);
      try {
        const res = await fetch("/api/window/price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = await res.json();
        if (my !== seq.current) return;
        if (res.ok) {
          setPrice(out);
          setIssues([]);
        } else {
          setPrice(null);
          setIssues(out.issues ?? [{ code: "UNMANUFACTURABLE", message: out.error ?? "Cannot price" }]);
        }
      } finally {
        if (my === seq.current) setPricing(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [product.id, product.templateRevision, widthIn, heightIn, selections, dealerAccountId]);

  async function addToQuote() {
    setAdding(true);
    setAdded(null);
    try {
      const res = await fetch("/api/quote-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qty,
          ...(dealerAccountId ? { dealerAccountId } : {}),
          window: {
            productId: product.id,
            templateRevision: product.templateRevision,
            widthIn: Number(widthIn),
            heightIn: Number(heightIn),
            room: room || undefined,
            selections,
            specialInstructions: notes || undefined,
          },
        }),
      });
      const out = await res.json();
      if (!res.ok) {
        setIssues(out.issues ?? [{ code: "UNMANUFACTURABLE", message: out.error ?? "Failed to add" }]);
        return;
      }
      setAdded(out.quoteRef);
      router.refresh();
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      {/* left: sections */}
      <div className="space-y-4">
        {/* dimensions */}
        <Card className="p-5">
          <div className="text-sm font-semibold text-ink">Window</div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {template.dimensions.map((d) => {
              const val = d.key === "width" ? widthIn : heightIn;
              const set = d.key === "width" ? setWidthIn : setHeightIn;
              const n = Number(val);
              return (
                <label key={d.key} className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">
                    {d.label} (in) · {d.min}–{d.max}″
                  </span>
                  <Input
                    value={val}
                    onChange={(e) => set(e.target.value)}
                    inputMode="decimal"
                    className="w-32"
                  />
                  {Number.isFinite(n) && n > 0 && (
                    <span className="mt-1 block text-[11px] text-muted">{formatInches(n)}</span>
                  )}
                </label>
              );
            })}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Room</span>
              <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. Master Bedroom" className="w-44" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Qty</span>
              <Input
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(500, Math.round(Number(e.target.value) || 1))))}
                inputMode="numeric"
                className="w-16"
              />
            </label>
          </div>
        </Card>

        {template.sections.map((section) => {
          if (!evalCondition(section.visibleWhen, effective)) return null;
          const fields = template.fields.filter((f) => {
            if (f.section !== section.key) return false;
            const p = product.fieldPolicies[f.key];
            if (p && !p.isOffered) return false;
            return evalCondition(f.visibleWhen, effective);
          });
          if (fields.length === 0) return null;
          return (
            <Card key={section.key} className="p-5">
              <div className="text-sm font-semibold text-ink">{section.label}</div>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {fields.map((f) => (
                  <FieldControl
                    key={f.key}
                    field={f}
                    policy={product.fieldPolicies[f.key]}
                    value={effective[f.key]}
                    issue={issueFor(f.key)}
                    onChange={(v) => setSelections((s) => ({ ...s, [f.key]: v }))}
                  />
                ))}
              </div>
            </Card>
          );
        })}

        <Card className="p-5">
          <div className="text-sm font-semibold text-ink">Special instructions</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything production should know for this window…"
            className="mt-2 h-20 w-full rounded-lg border border-line bg-white p-3 text-sm"
          />
        </Card>
      </div>

      {/* right: price rail */}
      <div className="lg:sticky lg:top-4 h-fit space-y-3">
        <Card className="p-5">
          {dealers.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Price as</span>
              <Select value={dealerAccountId} onChange={(e) => setDealerAccountId(Number(e.target.value))}>
                <option value={0}>MSRP preview</option>
                {dealers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <div className="mt-4">
            {price ? (
              <>
                <div className="text-2xl font-bold tabular-nums text-ink">
                  {usd(price.unitPrice * qty)}
                  {pricing && <span className="ml-2 align-middle text-xs font-normal text-muted">updating…</span>}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {qty} × {usd(price.unitPrice)}
                  {price.factor !== 1 && price.factor !== 0 ? ` (MSRP ${usd(price.msrpUnit)})` : ""}
                </div>
                <div className="mt-3 space-y-1 border-t border-line/60 pt-3 text-xs">
                  <div className="flex justify-between text-muted">
                    <span>Base{price.priceGroupKey ? ` · ${price.priceGroupKey}` : ""}</span>
                    <span className="tabular-nums">{usd(price.msrpBase)}</span>
                  </div>
                  {price.surcharges.map((s, i) => (
                    <div key={i} className="flex justify-between text-muted">
                      <span>{s.label}</span>
                      <span className="tabular-nums">{usd(s.amount)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted">{pricing ? "Pricing…" : "Complete the configuration to see a price."}</div>
            )}
          </div>
          {lineIssues.length > 0 && (
            <div className="mt-3 space-y-1 rounded-lg border border-red-200 bg-red-50 p-3">
              {lineIssues.map((i, n) => (
                <div key={n} className="text-xs text-red-700">
                  {i.message}
                </div>
              ))}
            </div>
          )}
          <Button className="mt-4 w-full" onClick={addToQuote} disabled={adding || !price}>
            {adding ? "Adding…" : "Add to quote"}
          </Button>
          {added && (
            <div className="mt-2 text-center text-xs text-emerald-700">
              Added to quote <span className="font-semibold">{added}</span> ✓
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FieldControl({
  field,
  policy,
  value,
  issue,
  onChange,
}: {
  field: TemplateField;
  policy: FieldPolicy | undefined;
  value: unknown;
  issue?: ValidationIssue;
  onChange: (v: unknown) => void;
}) {
  const label = (policy && "labelOverride" in policy && policy.labelOverride) || field.label;

  const control = (() => {
    switch (field.control.kind) {
      case "select": {
        const allowed =
          policy?.controlKind === "select"
            ? new Set(policy.allowedValues.map(String))
            : null;
        const optionLabels = policy?.controlKind === "select" ? policy.optionLabels : undefined;
        const options = field.control.options.filter((o) => !allowed || allowed.has(String(o.value)));
        return (
          <Select value={String(value ?? "")} onChange={(e) => {
            const raw = e.target.value;
            const match = options.find((o) => String(o.value) === raw);
            onChange(match ? match.value : raw);
          }}>
            {options.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {optionLabels?.[String(o.value)] ?? o.label}
              </option>
            ))}
          </Select>
        );
      }
      case "toggle":
        return (
          <label className="flex h-9 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              className="size-4 accent-ink"
            />
            <span className="text-sm text-ink-soft">{Boolean(value) ? "Yes" : "No"}</span>
          </label>
        );
      case "slider": {
        const range =
          policy?.controlKind === "slider"
            ? policy.range
            : { min: field.control.min, max: field.control.max, step: field.control.step };
        return (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={range.step}
              value={Number(value ?? range.min)}
              onChange={(e) => onChange(Number(e.target.value))}
              className="flex-1 accent-ink"
            />
            <span className="w-14 text-right text-xs tabular-nums text-muted">{String(value)}</span>
          </div>
        );
      }
      case "color": {
        const colors =
          policy?.controlKind === "color"
            ? policy.allowedColors
            : (field.control.options ?? []).map((o) => ({
                optionId: String(o.value),
                label: o.label,
                value: String(o.hex ?? o.value).toLowerCase(),
              }));
        return (
          <div className="flex flex-wrap gap-1.5">
            {colors.map((c) => (
              <button
                key={c.optionId}
                title={c.label}
                onClick={() => onChange(c.value)}
                className={cx(
                  "size-7 rounded-full border border-black/10",
                  value === c.value && "ring-2 ring-offset-1 ring-ink"
                )}
                style={{ background: c.value }}
              />
            ))}
            {colors.length === 0 && <span className="text-xs text-muted">No colors configured</span>}
          </div>
        );
      }
      case "text":
        return (
          <Input
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.control.placeholder}
          />
        );
      case "image":
        return <span className="text-xs text-muted">Pattern selection — configure patterns on the product first.</span>;
    }
  })();

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {control}
      {issue && <span className="mt-1 block text-[11px] text-red-600">{issue.message}</span>}
    </label>
  );
}
