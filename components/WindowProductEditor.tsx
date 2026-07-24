"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  FieldPolicy,
  TemplateField,
  WindowProduct,
  WindowTemplate,
} from "@/lib/window/types";
import { Badge, Button, Card, Input, cx } from "./ui";
import WindowPricingPanel, { type PricingState } from "./WindowPricingPanel";

// Admin editor for one window product. Interaction model mirrors blind-bot's 3D variants
// section: per field — offer toggle, narrowed allowed values, default. Saves are PATCHes that
// merge only the dirty policies by key; the response DTO refreshes local state (no follow-up GET).

type Props = {
  initialProduct: WindowProduct;
  template: WindowTemplate;
  initialPricing: PricingState;
  dealers: { id: number; name: string }[];
};

export default function WindowProductEditor({ initialProduct, template, initialPricing, dealers }: Props) {
  const [product, setProduct] = useState(initialProduct);
  const [tab, setTab] = useState<"options" | "pricing">("options");
  const [dirty, setDirty] = useState<Record<string, FieldPolicy>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policies = useMemo(
    () => ({ ...product.fieldPolicies, ...dirty }),
    [product.fieldPolicies, dirty]
  );

  const fieldsBySection = useMemo(() => {
    const m = new Map<string, TemplateField[]>();
    for (const f of template.fields) {
      if (!m.has(f.section)) m.set(f.section, []);
      m.get(f.section)!.push(f);
    }
    return m;
  }, [template.fields]);

  function setPolicy(key: string, next: FieldPolicy) {
    setDirty((d) => ({ ...d, [key]: next }));
  }

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/window/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(Object.keys(dirty).length ? { fieldPolicies: dirty } : {}), ...extra }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setProduct(body.product);
      setDirty({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">{product.name}</h1>
          <div className="mt-0.5 text-xs text-muted">
            {template.label} · template rev {product.templateRevision}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={
              product.status === "active"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }
          >
            {product.status}
          </Badge>
          {product.status !== "active" ? (
            <Button variant="secondary" onClick={() => save({ status: "active" })} disabled={saving}>
              Activate
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => save({ status: "draft" })} disabled={saving}>
              Unpublish
            </Button>
          )}
          <Link
            href={`/window-products/${product.id}/configure`}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-black/[.03]"
          >
            Preview / Configure
          </Link>
          <Button onClick={() => save()} disabled={saving || Object.keys(dirty).length === 0}>
            {saving ? "Saving…" : `Save${Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ""}`}
          </Button>
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}

      {/* tabs */}
      <div className="mt-5 flex gap-1 border-b border-line">
        {(["options", "pricing"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cx(
              "rounded-t-lg px-4 py-2 text-sm font-medium",
              tab === t ? "border border-b-0 border-line bg-white text-ink" : "text-muted hover:text-ink"
            )}
          >
            {t === "options" ? "Options" : "Pricing"}
          </button>
        ))}
      </div>

      {tab === "options" ? (
        <div className="mt-4 space-y-4">
          {[...fieldsBySection.entries()].map(([sectionKey, fields]) => {
            const section = template.sections.find((s) => s.key === sectionKey);
            return (
              <Card key={sectionKey} className="p-0">
                <div className="border-b border-line/60 px-5 py-3 text-sm font-semibold text-ink">
                  {section?.label ?? sectionKey}
                </div>
                <div className="divide-y divide-line/40">
                  {fields.map((f) => (
                    <FieldPolicyRow
                      key={f.key}
                      field={f}
                      policy={policies[f.key]}
                      changed={f.key in dirty}
                      onChange={(p) => setPolicy(f.key, p)}
                    />
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <WindowPricingPanel
          productId={product.id}
          template={template}
          policies={policies}
          initial={initialPricing}
          dealers={dealers}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function FieldPolicyRow({
  field,
  policy,
  changed,
  onChange,
}: {
  field: TemplateField;
  policy: FieldPolicy | undefined;
  changed: boolean;
  onChange: (p: FieldPolicy) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const offered = policy?.isOffered ?? true;

  // A missing policy means "template defaults" — materialize one lazily on first edit.
  function base(): FieldPolicy {
    if (policy) return policy;
    switch (field.control.kind) {
      case "select":
        return {
          isOffered: true,
          controlKind: "select",
          allowedValues: field.control.options.map((o) => o.value),
          defaultValue: field.defaultValue as string | number,
        };
      case "toggle":
        return { isOffered: true, controlKind: "toggle", defaultValue: Boolean(field.defaultValue) };
      case "slider":
        return {
          isOffered: true,
          controlKind: "slider",
          range: { min: field.control.min, max: field.control.max, step: field.control.step },
          defaultValue: Number(field.defaultValue),
        };
      case "color":
        return {
          isOffered: true,
          controlKind: "color",
          allowedColors: (field.control.options ?? []).map((o) => ({
            optionId: String(o.value),
            label: o.label,
            value: String(o.hex ?? o.value).toLowerCase(),
          })),
          defaultValue: String(field.defaultValue ?? "").toLowerCase(),
        };
      case "image":
        return { isOffered: true, controlKind: "image", allowedPatterns: [], defaultPattern: null };
      case "text":
        return { isOffered: true, controlKind: "text", defaultValue: String(field.defaultValue ?? "") };
    }
  }

  const summary = (() => {
    if (field.control.kind === "select") {
      const total = field.control.options.length;
      const allowed = policy?.controlKind === "select" ? policy.allowedValues.length : total;
      return `${allowed}/${total} values`;
    }
    if (field.control.kind === "slider") return `range ${field.control.min}–${field.control.max}`;
    if (field.control.kind === "color") {
      const n = policy?.controlKind === "color" ? policy.allowedColors.length : (field.control.options ?? []).length;
      return `${n} colors`;
    }
    return field.control.kind;
  })();

  return (
    <div className={cx("px-5 py-3", !offered && "opacity-55")}>
      <div className="flex items-center justify-between gap-3">
        <label className="flex min-w-0 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={offered}
            onChange={(e) => onChange({ ...base(), isOffered: e.target.checked })}
            className="size-4 accent-ink"
          />
          <span className="truncate text-sm font-medium text-ink">
            {(policy && "labelOverride" in policy && policy.labelOverride) || field.label}
          </span>
          {changed && <span className="size-1.5 rounded-full bg-amber-500" title="Unsaved change" />}
          {field.origin === "commercial" && (
            <Badge className="border-sky-200 bg-sky-50 text-sky-700">commercial</Badge>
          )}
        </label>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-xs text-muted">{summary}</span>
          {(field.control.kind === "select" || field.control.kind === "color") && (
            <button className="text-xs font-medium text-ink-soft hover:text-ink" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Collapse" : "Edit values"}
            </button>
          )}
        </div>
      </div>

      {expanded && field.control.kind === "select" && (
        <SelectValuesEditor field={field} policy={base()} onChange={onChange} />
      )}
      {expanded && field.control.kind === "color" && (
        <ColorValuesEditor field={field} policy={base()} onChange={onChange} />
      )}
    </div>
  );
}

function SelectValuesEditor({
  field,
  policy,
  onChange,
}: {
  field: TemplateField;
  policy: FieldPolicy;
  onChange: (p: FieldPolicy) => void;
}) {
  if (policy.controlKind !== "select" || field.control.kind !== "select") return null;
  const p = policy; // narrowed select policy
  const options = field.control.options;
  const allowed = new Set(p.allowedValues.map(String));

  function toggleValue(v: string | number) {
    const next = new Set(allowed);
    const k = String(v);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    const allowedValues = options.map((o) => o.value).filter((x) => next.has(String(x)));
    if (allowedValues.length === 0) return; // never allow an empty offer
    const defaultValue = allowedValues.some((x) => x === p.defaultValue) ? p.defaultValue : allowedValues[0];
    onChange({ ...p, allowedValues, defaultValue });
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 pl-7">
      {options.map((o) => {
        const on = allowed.has(String(o.value));
        const isDefault = p.defaultValue === o.value;
        return (
          <button
            key={String(o.value)}
            onClick={() => toggleValue(o.value)}
            onDoubleClick={() => on && onChange({ ...p, defaultValue: o.value })}
            title={on ? "Click to disable · double-click to set default" : "Click to enable"}
            className={cx(
              "rounded-full border px-3 py-1 text-xs font-medium",
              on ? "border-ink/30 bg-ink/5 text-ink" : "border-line text-muted line-through",
              isDefault && "ring-2 ring-amber-400"
            )}
          >
            {o.label}
          </button>
        );
      })}
      <span className="self-center text-[11px] text-muted">double-click = default (ringed)</span>
    </div>
  );
}

function ColorValuesEditor({
  policy,
  onChange,
}: {
  field: TemplateField;
  policy: FieldPolicy;
  onChange: (p: FieldPolicy) => void;
}) {
  const [label, setLabel] = useState("");
  const [hex, setHex] = useState("#ffffff");
  if (policy.controlKind !== "color") return null;

  return (
    <div className="mt-3 pl-7">
      <div className="flex flex-wrap gap-2">
        {policy.allowedColors.map((c) => (
          <button
            key={c.optionId}
            onClick={() =>
              onChange({ ...policy, allowedColors: policy.allowedColors.filter((x) => x.optionId !== c.optionId) })
            }
            onDoubleClick={() => onChange({ ...policy, defaultValue: c.value })}
            title={`${c.label} — click to remove · double-click to set default`}
            className={cx(
              "flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-xs",
              policy.defaultValue === c.value && "ring-2 ring-amber-400"
            )}
          >
            <span className="size-3.5 rounded-full border border-black/10" style={{ background: c.value }} />
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          className="size-8 cursor-pointer rounded border border-line"
        />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Color name" className="w-40" />
        <Button
          variant="secondary"
          onClick={() => {
            if (!label.trim()) return;
            const value = hex.toLowerCase();
            onChange({
              ...policy,
              allowedColors: [
                ...policy.allowedColors,
                { optionId: label.trim().toLowerCase().replace(/\s+/g, "_"), label: label.trim(), value },
              ],
              defaultValue: policy.allowedColors.length === 0 ? value : policy.defaultValue,
            });
            setLabel("");
          }}
        >
          Add color
        </Button>
      </div>
    </div>
  );
}
