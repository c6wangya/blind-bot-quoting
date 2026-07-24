"use client";

import { useMemo, useState } from "react";
import type {
  FieldPolicy,
  PriceGrid,
  PriceGroup,
  PriceGroupMap,
  SizeConstraint,
  SurchargeKind,
  SurchargeRule,
  WindowTemplate,
} from "@/lib/window/types";
import { Button, Card, Input, Select } from "./ui";

// Pricing tab for one window product: price groups, fabric→group routing, W×H grid
// (paste-from-Excel), option surcharges, size constraints. Mirrors the anchor customer's
// Excel model 1:1 — grids by group, round-up breaks, surcharges by width band, limits per option.

export type PricingState = {
  priceGroups: PriceGroup[];
  priceGroupMaps: PriceGroupMap[];
  priceGrids: PriceGrid[];
  surchargeRules: SurchargeRule[];
  sizeConstraints: SizeConstraint[];
};

type Props = {
  productId: number;
  template: WindowTemplate;
  policies: Record<string, FieldPolicy>;
  initial: PricingState;
  dealers: { id: number; name: string }[];
};

export default function WindowPricingPanel({ productId, template, policies, initial }: Props) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function action(body: Record<string, unknown>): Promise<unknown> {
    setError(null);
    const res = await fetch(`/api/window/products/${productId}/pricing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    if (!res.ok) {
      setError(out.error ?? "Action failed");
      throw new Error(out.error);
    }
    return out;
  }

  async function refresh() {
    const res = await fetch(`/api/window/products/${productId}/pricing`);
    if (res.ok) setState(await res.json());
  }

  // Fields a price group can key on: offered select/color fields (fabric/color axes in practice).
  const mappableFields = useMemo(
    () =>
      template.fields.filter(
        (f) =>
          (f.control.kind === "select" || f.control.kind === "color") && (policies[f.key]?.isOffered ?? true)
      ),
    [template.fields, policies]
  );

  return (
    <div className="mt-4 space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}
      <GroupsCard state={state} onAction={action} onDone={refresh} />
      <MappingCard state={state} fields={mappableFields} policies={policies} onAction={action} onDone={refresh} />
      <GridCard state={state} onAction={action} onDone={refresh} />
      <SurchargesCard state={state} fields={template.fields} onAction={action} onDone={refresh} />
      <ConstraintsCard state={state} fields={template.fields} onAction={action} onDone={refresh} />
    </div>
  );
}

type CardProps = {
  state: PricingState;
  onAction: (body: Record<string, unknown>) => Promise<unknown>;
  onDone: () => Promise<void>;
};

// ---------------------------------------------------------------------------

function GroupsCard({ state, onAction, onDone }: CardProps) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-ink">Price groups</div>
      <p className="mt-1 text-xs text-muted">
        Fabrics/options route to a group; each group has one W×H price grid (e.g. RSA…RSD, Group 1…7).
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {state.priceGroups.map((g) => (
          <span key={g.id} className="rounded-full border border-line bg-black/[.03] px-3 py-1 text-xs font-medium text-ink">
            {g.key}
            {g.label ? ` · ${g.label}` : ""}
          </span>
        ))}
        {state.priceGroups.length === 0 && <span className="text-xs text-muted">None yet.</span>}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Key (e.g. RSA)" className="w-36" />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="w-52" />
        <Button
          variant="secondary"
          disabled={!key.trim()}
          onClick={async () => {
            await onAction({ action: "upsertGroup", group: { key: key.trim(), label: label.trim() || undefined } });
            setKey("");
            setLabel("");
            await onDone();
          }}
        >
          Add group
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function MappingCard({
  state,
  fields,
  policies,
  onAction,
  onDone,
}: CardProps & { fields: WindowTemplate["fields"]; policies: Record<string, FieldPolicy> }) {
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? "");
  const field = fields.find((f) => f.key === fieldKey);
  const policy = field ? policies[field.key] : undefined;

  // The values to route = the offered values of the chosen field.
  const values: { token: string; label: string }[] = useMemo(() => {
    if (!field) return [];
    if (policy?.controlKind === "select") {
      const labels = new Map(
        field.control.kind === "select" ? field.control.options.map((o) => [String(o.value), o.label]) : []
      );
      return policy.allowedValues.map((v) => ({ token: String(v), label: labels.get(String(v)) ?? String(v) }));
    }
    if (policy?.controlKind === "color") {
      return policy.allowedColors.map((c) => ({ token: c.value, label: c.label }));
    }
    if (field.control.kind === "select" || field.control.kind === "color") {
      return (field.control.options ?? []).map((o) => ({ token: String(o.value), label: o.label }));
    }
    return [];
  }, [field, policy]);

  const currentByToken = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of state.priceGroupMaps) if (row.fieldKey === fieldKey) m.set(row.valueToken, row.priceGroupId);
    return m;
  }, [state.priceGroupMaps, fieldKey]);

  const [draft, setDraft] = useState<Map<string, number>>(new Map());
  const groupIdOf = (token: string) => draft.get(token) ?? currentByToken.get(token) ?? 0;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">Value → price group routing</div>
          <p className="mt-1 text-xs text-muted">Which option value decides the grid (typically the fabric/color axis).</p>
        </div>
        <Select value={fieldKey} onChange={(e) => { setFieldKey(e.target.value); setDraft(new Map()); }} className="w-52">
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      {values.length > 0 ? (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {values.map((v) => (
              <label key={v.token} className="flex items-center justify-between gap-2 rounded-lg border border-line/60 px-3 py-1.5">
                <span className="truncate text-xs font-medium text-ink">{v.label}</span>
                <Select
                  value={groupIdOf(v.token)}
                  onChange={(e) => setDraft(new Map(draft).set(v.token, Number(e.target.value)))}
                  className="w-32 text-xs"
                >
                  <option value={0}>—</option>
                  {state.priceGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.key}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="secondary"
              disabled={draft.size === 0}
              onClick={async () => {
                const entries = values
                  .map((v) => ({ valueToken: v.token, priceGroupId: groupIdOf(v.token) }))
                  .filter((e) => e.priceGroupId > 0);
                await onAction({ action: "setMaps", fieldKey, entries });
                setDraft(new Map());
                await onDone();
              }}
            >
              Save routing
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-muted">This field has no offered values to route.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

/** Parse a grid pasted from Excel: first row = width breaks, first column = height breaks,
 *  body = MSRP (blank / "N/A" / "-" = unmanufacturable). Tab or comma separated. */
function parsePastedGrid(text: string): { widthBreaks: number[]; heightBreaks: number[]; cells: (number | null)[][] } {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((r) => r.split(/\t|,/).map((c) => c.trim()));
  if (rows.length < 2 || rows[0].length < 2) throw new Error("Paste at least a header row + one data row");
  const widthBreaks = rows[0].slice(1).map((c) => Number(c));
  if (widthBreaks.some((n) => !Number.isFinite(n))) throw new Error("First row must be width breaks (numbers)");
  const heightBreaks: number[] = [];
  const cells: (number | null)[][] = [];
  for (const row of rows.slice(1)) {
    const h = Number(row[0]);
    if (!Number.isFinite(h)) throw new Error(`Row header "${row[0]}" is not a number`);
    heightBreaks.push(h);
    cells.push(
      row.slice(1, widthBreaks.length + 1).map((c) => {
        if (c === "" || /^(n\/?a|-|—)$/i.test(c)) return null;
        const n = Number(c.replace(/[$,]/g, ""));
        if (!Number.isFinite(n)) throw new Error(`"${c}" is not a price`);
        return n;
      })
    );
  }
  // Grids are often authored descending (Excel style); normalize to ascending on both axes.
  const wOrder = widthBreaks.map((_, i) => i).sort((a, b) => widthBreaks[a] - widthBreaks[b]);
  const hOrder = heightBreaks.map((_, i) => i).sort((a, b) => heightBreaks[a] - heightBreaks[b]);
  return {
    widthBreaks: wOrder.map((i) => widthBreaks[i]),
    heightBreaks: hOrder.map((i) => heightBreaks[i]),
    cells: hOrder.map((hi) => wOrder.map((wi) => cells[hi][wi])),
  };
}

function GridCard({ state, onAction, onDone }: CardProps) {
  const [groupId, setGroupId] = useState(0);
  const [pasted, setPasted] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-ink">Price grids (W×H, MSRP)</div>
      <p className="mt-1 text-xs text-muted">
        Paste straight from Excel: first row = width breaks, first column = height breaks, blank/N/A = size not
        manufacturable. Lookups round UP to the next break. Saving replaces the group&apos;s current grid (old one
        stays for order history).
      </p>
      <div className="mt-3 space-y-2">
        {state.priceGroups.map((g) => {
          const grid = state.priceGrids.find((x) => x.priceGroupId === g.id);
          return (
            <div key={g.id} className="flex items-center justify-between rounded-lg border border-line/60 px-3 py-2 text-xs">
              <span className="font-medium text-ink">{g.key}</span>
              {grid ? (
                <span className="text-muted">
                  {grid.widthBreaks.length}×{grid.heightBreaks.length} · W ≤{grid.widthBreaks.at(-1)}″ · H ≤
                  {grid.heightBreaks.at(-1)}″ · since {new Date(grid.effectiveFrom).toLocaleDateString()}
                </span>
              ) : (
                <span className="text-amber-600">no grid yet</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Select value={groupId} onChange={(e) => setGroupId(Number(e.target.value))} className="w-40">
          <option value={0}>Choose group…</option>
          {state.priceGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.key}
            </option>
          ))}
        </Select>
      </div>
      <textarea
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder={"\t24\t36\t48\t60\n36\t120\t145\t170\t198\n48\t138\t166\t199\t231\n60\t152\t187\t224\t262"}
        className="mt-2 h-36 w-full rounded-lg border border-line bg-white p-3 font-mono text-xs"
      />
      {parseError && <div className="mt-1 text-xs text-red-600">{parseError}</div>}
      <div className="mt-2 flex justify-end">
        <Button
          variant="secondary"
          disabled={!groupId || !pasted.trim()}
          onClick={async () => {
            setParseError(null);
            try {
              const grid = parsePastedGrid(pasted);
              await onAction({ action: "addGrid", grid: { priceGroupId: groupId, ...grid } });
              setPasted("");
              await onDone();
            } catch (err) {
              setParseError((err as Error).message);
            }
          }}
        >
          Save grid
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

const KIND_LABELS: Record<SurchargeKind, string> = {
  flat: "Flat $",
  per_unit: "Per unit $",
  percent: "% of base",
  width_band: "By width band",
  per_linear_ft: "Per linear ft",
};

function SurchargesCard({ state, fields, onAction, onDone }: CardProps & { fields: WindowTemplate["fields"] }) {
  const [label, setLabel] = useState("");
  const [fieldKey, setFieldKey] = useState("");
  const [valueToken, setValueToken] = useState("");
  const [kind, setKind] = useState<SurchargeKind>("flat");
  const [amount, setAmount] = useState("");
  const [bands, setBands] = useState(""); // "24:135, 48:160, 96:250"

  const field = fields.find((f) => f.key === fieldKey);
  const tokenOptions =
    field?.control.kind === "select" ? field.control.options.map((o) => ({ v: String(o.value), l: o.label })) : [];
  const isToggle = field?.control.kind === "toggle";

  async function add() {
    const matcher = isToggle
      ? { fieldKey, truthy: true }
      : valueToken
        ? { fieldKey, valueToken }
        : { fieldKey };
    let amt: Record<string, unknown>;
    if (kind === "percent") amt = { pct: Number(amount) };
    else if (kind === "width_band") {
      const pairs = bands
        .split(/[,;]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.split(":").map(Number));
      amt = { breaks: pairs.map((x) => x[0]), values: pairs.map((x) => x[1]) };
    } else if (kind === "per_linear_ft") amt = { value: Number(amount), dimension: "height" };
    else amt = { value: Number(amount) };
    await onAction({ action: "addSurcharge", rule: { label, matcher, kind, amount: amt } });
    setLabel("");
    setValueToken("");
    setAmount("");
    setBands("");
    await onDone();
  }

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-ink">Option surcharges</div>
      <div className="mt-3 space-y-1.5">
        {state.surchargeRules.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-line/60 px-3 py-1.5 text-xs">
            <span>
              <span className="font-medium text-ink">{r.label}</span>{" "}
              <span className="text-muted">
                when {r.matcher.fieldKey}
                {r.matcher.valueToken ? ` = ${r.matcher.valueToken}` : r.matcher.truthy ? " is on" : ""} ·{" "}
                {KIND_LABELS[r.kind]}{" "}
                {r.kind === "percent"
                  ? `${r.amount.pct}%`
                  : r.kind === "width_band"
                    ? (r.amount.breaks ?? []).map((b, i) => `≤${b}″:$${r.amount.values?.[i]}`).join(" ")
                    : `$${r.amount.value}`}
                {r.productId == null ? " · org-wide" : ""}
              </span>
            </span>
            <button
              className="font-medium text-red-500 hover:text-red-700"
              onClick={async () => {
                await onAction({ action: "removeSurcharge", id: r.id });
                await onDone();
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {state.surchargeRules.length === 0 && <div className="text-xs text-muted">None yet.</div>}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Cordless)" className="w-40" />
        <Select value={fieldKey} onChange={(e) => { setFieldKey(e.target.value); setValueToken(""); }} className="w-44">
          <option value="">Field…</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
        {tokenOptions.length > 0 && (
          <Select value={valueToken} onChange={(e) => setValueToken(e.target.value)} className="w-44">
            <option value="">any value</option>
            {tokenOptions.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </Select>
        )}
        <Select value={kind} onChange={(e) => setKind(e.target.value as SurchargeKind)} className="w-36">
          {Object.entries(KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        {kind === "width_band" ? (
          <Input value={bands} onChange={(e) => setBands(e.target.value)} placeholder="24:135, 48:160, 96:250" className="w-52" />
        ) : (
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={kind === "percent" ? "%" : "$"} className="w-24" />
        )}
        <Button variant="secondary" disabled={!label.trim() || !fieldKey} onClick={add}>
          Add
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ConstraintsCard({ state, fields, onAction, onDone }: CardProps & { fields: WindowTemplate["fields"] }) {
  const [fieldKey, setFieldKey] = useState("");
  const [valueToken, setValueToken] = useState("");
  const [dimension, setDimension] = useState<"width" | "height" | "area_sqft">("width");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");

  const field = fields.find((f) => f.key === fieldKey);
  const tokenOptions =
    field?.control.kind === "select" ? field.control.options.map((o) => ({ v: String(o.value), l: o.label })) : [];
  const isToggle = field?.control.kind === "toggle";

  return (
    <Card className="p-5">
      <div className="text-sm font-semibold text-ink">Size limits</div>
      <p className="mt-1 text-xs text-muted">Min/max size per option — e.g. Cordless width 19–96″, Motorized max 120″.</p>
      <div className="mt-3 space-y-1.5">
        {state.sizeConstraints.map((c) => (
          <div key={c.id} className="flex items-center justify-between rounded-lg border border-line/60 px-3 py-1.5 text-xs">
            <span className="text-muted">
              <span className="font-medium text-ink">
                {c.matcher.fieldKey}
                {c.matcher.valueToken ? ` = ${c.matcher.valueToken}` : ""}
              </span>{" "}
              → {c.dimension.replace("_", " ")} {c.minValue != null ? `≥ ${c.minValue}` : ""}{" "}
              {c.maxValue != null ? `≤ ${c.maxValue}` : ""}
            </span>
            <button
              className="font-medium text-red-500 hover:text-red-700"
              onClick={async () => {
                await onAction({ action: "removeConstraint", id: c.id });
                await onDone();
              }}
            >
              Remove
            </button>
          </div>
        ))}
        {state.sizeConstraints.length === 0 && <div className="text-xs text-muted">None yet.</div>}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Select value={fieldKey} onChange={(e) => { setFieldKey(e.target.value); setValueToken(""); }} className="w-44">
          <option value="">Field…</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
        {tokenOptions.length > 0 && (
          <Select value={valueToken} onChange={(e) => setValueToken(e.target.value)} className="w-44">
            <option value="">any value</option>
            {tokenOptions.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </Select>
        )}
        <Select value={dimension} onChange={(e) => setDimension(e.target.value as typeof dimension)} className="w-32">
          <option value="width">width</option>
          <option value="height">height</option>
          <option value="area_sqft">area sqft</option>
        </Select>
        <Input value={min} onChange={(e) => setMin(e.target.value)} placeholder="min" className="w-20" />
        <Input value={max} onChange={(e) => setMax(e.target.value)} placeholder="max" className="w-20" />
        <Button
          variant="secondary"
          disabled={!fieldKey || (!min && !max)}
          onClick={async () => {
            const matcher = isToggle ? { fieldKey, truthy: true } : valueToken ? { fieldKey, valueToken } : { fieldKey };
            await onAction({
              action: "addConstraint",
              constraint: {
                matcher,
                dimension,
                minValue: min ? Number(min) : undefined,
                maxValue: max ? Number(max) : undefined,
              },
            });
            setMin("");
            setMax("");
            setValueToken("");
            await onDone();
          }}
        >
          Add
        </Button>
      </div>
    </Card>
  );
}
