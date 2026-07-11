"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { usd } from "@/lib/format";
import { useToast } from "./Toast";
import { Button, Card, cx, Spinner } from "./ui";

export type PriceRow = {
  modelId: string;
  name: string;
  sku: string;
  category: string;
  brand: string;
  /** Shared Default (retail) price — read-only reference on the Business / retailer screens. */
  defaultPrice: number;
  /** Shared (global) Business-tier price (falls back to Default). Read-only ref on the retailer screen. */
  businessPrice: number;
  /** This retailer's explicit override (tier='default'), or null if none. Retailer screen only. */
  overridePrice: number | null;
  /** This retailer's explicit personal Business price (tier='business'), or null. Retailer screen only. */
  personalBusinessPrice: number | null;
  /** Seed for the single editable input on the Default / shared-Business screens. */
  currentPrice: number;
  hasOverride: boolean;
};
export type Target =
  | { kind: "default" }
  | { kind: "business" }
  | { kind: "retailer"; retailerId: string; label: string; businessEnabled: boolean };

// A price column — either a read-only reference or an editable tier.
type ColKey = "default" | "business" | "personalBusiness" | "override";
type Col = { key: ColKey; label: string };

const REF_W = 96; // read-only reference column
const INPUT_W = 108; // editable price input column
const W_INPUT = "w-24"; // the $ input box inside an editable column
const W_SAVE = "w-20"; // Save button / "Save all" header
const W_RESET = "w-14"; // Reset button / "Reset all" header

const refColsFor = (t: Target): Col[] =>
  t.kind === "retailer"
    ? [
        { key: "default", label: "Default" },
        { key: "business", label: "Global business" },
      ]
    : t.kind === "business"
      ? [{ key: "default", label: "Default" }]
      : [];

const editColsFor = (t: Target): Col[] =>
  t.kind === "retailer"
    ? [
        { key: "personalBusiness", label: "Personal business" },
        { key: "override", label: "This retailer" },
      ]
    : t.kind === "business"
      ? [{ key: "business", label: "Business" }]
      : [{ key: "default", label: "Price" }];

const cellKey = (modelId: string, col: ColKey) => `${modelId}::${col}`;

/** The value an editable column's input is pre-filled with — the price currently in effect there,
 *  so an un-set cell shows the value it inherits and stays un-set until the admin edits it. */
function seedFor(row: PriceRow, col: ColKey, businessEnabled: boolean): number {
  switch (col) {
    case "default":
      return row.defaultPrice;
    case "business":
      return row.businessPrice;
    case "personalBusiness":
      return row.personalBusinessPrice ?? row.businessPrice;
    case "override":
      return (
        row.overridePrice ??
        (businessEnabled ? row.personalBusinessPrice ?? row.businessPrice : row.defaultPrice)
      );
  }
}

const refValue = (row: PriceRow, col: ColKey) => (col === "business" ? row.businessPrice : row.defaultPrice);
const hasCustom = (row: PriceRow, col: ColKey) =>
  col === "personalBusiness" ? row.personalBusinessPrice != null : col === "override" ? row.overridePrice != null : false;

/** Build the POST body that persists one price cell. */
function bodyFor(col: ColKey, modelId: string, price: number, retailerId?: string): unknown {
  switch (col) {
    case "personalBusiness":
      return { modelId, retailerId, price, tier: "business" };
    case "override":
      return { modelId, retailerId, price };
    case "business":
      return { modelId, price, tier: "business" };
    case "default":
      return { modelId, price };
  }
}

const post = async (body: unknown) => {
  const r = await fetch("/api/motors/prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
};

/**
 * Admin: edit motor prices. The Default and shared-Business screens edit one tier; the per-retailer
 * screen edits two — the retailer's Personal business price and their explicit Override — alongside
 * read-only Default / Global-business reference columns.
 */
export function MotorPriceEditor({ target, rows }: { target: Target; rows: PriceRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const isRetailer = target.kind === "retailer";
  const retailerId = isRetailer ? target.retailerId : undefined;
  const businessEnabled = isRetailer ? target.businessEnabled : false;

  const refCols = refColsFor(target);
  const editCols = editColsFor(target);
  const gridTemplate = [
    "minmax(0,1fr)",
    ...refCols.map(() => `${REF_W}px`),
    ...editCols.map(() => `${INPUT_W}px`),
    "auto",
  ].join(" ");

  const seedValues = (rs: PriceRow[]) =>
    Object.fromEntries(
      rs.flatMap((r) => editCols.map((c) => [cellKey(r.modelId, c.key), String(seedFor(r, c.key, businessEnabled))]))
    ) as Record<string, string>;
  const seedBaseline = (rs: PriceRow[]) =>
    Object.fromEntries(
      rs.flatMap((r) => editCols.map((c) => [cellKey(r.modelId, c.key), seedFor(r, c.key, businessEnabled)]))
    ) as Record<string, number>;

  const [pending, setPending] = useState<"save" | "reset" | null>(null);
  const busy = pending !== null;
  const [values, setValues] = useState<Record<string, string>>(() => seedValues(rows));
  const setValue = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  // Re-baseline whenever the server sends fresh rows (e.g. after a save or the Business toggle flips).
  const [baseline, setBaseline] = useState<Record<string, number>>(() => seedBaseline(rows));
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setBaseline(seedBaseline(rows));
    setValues(seedValues(rows));
  }

  // Every changed cell across the whole table (valid input differing from the price in effect).
  const changedCells = rows.flatMap((r) =>
    editCols
      .map((c) => ({ modelId: r.modelId, col: c.key, k: cellKey(r.modelId, c.key) }))
      .filter(({ k }) => {
        const n = Number(values[k]);
        return Number.isFinite(n) && n >= 0 && n !== baseline[k];
      })
  );
  const canSave = !busy && changedCells.length > 0;

  const rowChanged = (modelId: string) => changedCells.filter((c) => c.modelId === modelId);

  // Persist one row's changed cells (used by the per-row Save button).
  const saveRow = async (modelId: string) => {
    for (const c of editCols) {
      const raw = values[cellKey(modelId, c.key)];
      if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) throw new Error("Enter a valid price");
    }
    const cells = rowChanged(modelId);
    if (cells.length === 0) return;
    for (const c of cells) await post(bodyFor(c.col, modelId, Number(values[c.k]), retailerId));
    setBaseline((b) => {
      const next = { ...b };
      for (const c of cells) next[c.k] = Number(values[c.k]);
      return next;
    });
    router.refresh();
  };

  // Clear one row's custom cells (per-row Reset — retailer only).
  const resetRow = async (modelId: string) => {
    const row = rows.find((r) => r.modelId === modelId);
    if (!row) return;
    for (const c of editCols) {
      if (hasCustom(row, c.key)) {
        await post({ retailerId, modelId, reset: true, tier: c.key === "personalBusiness" ? "business" : "default" });
      }
    }
    router.refresh();
  };

  const resetAll = async () => {
    if (!isRetailer) return;
    setPending("reset");
    try {
      await post({ retailerId, reset: true }); // both tiers
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPending(null);
    }
  };

  const saveAll = async () => {
    if (changedCells.length === 0) return;
    setPending("save");
    try {
      // Batch per column so a full screen of edits is a handful of requests, not one per cell.
      for (const c of editCols) {
        const cells = changedCells.filter((x) => x.col === c.key);
        if (cells.length === 0) continue;
        const prices = cells.map((x) => ({ modelId: x.modelId, price: Number(values[x.k]) }));
        await post(
          c.key === "personalBusiness"
            ? { retailerId, tier: "business", prices }
            : c.key === "override"
              ? { retailerId, prices }
              : c.key === "business"
                ? { tier: "business", prices }
                : { prices }
        );
      }
      setBaseline((b) => {
        const next = { ...b };
        for (const c of changedCells) next[c.k] = Number(values[c.k]);
        return next;
      });
      toast(`Saved ${changedCells.length} price${changedCells.length === 1 ? "" : "s"}`);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPending(null);
    }
  };

  // Group rows under a brand subheader, preserving each brand's first-seen order.
  const groups: { brand: string; rows: PriceRow[] }[] = [];
  const groupIdx = new Map<string, number>();
  for (const r of rows) {
    const brand = r.brand || "Other";
    let i = groupIdx.get(brand);
    if (i === undefined) {
      i = groups.length;
      groupIdx.set(brand, i);
      groups.push({ brand, rows: [] });
    }
    groups[i].rows.push(r);
  }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleBrand = (brand: string) => setCollapsed((c) => ({ ...c, [brand]: !c[brand] }));

  const totalCols = 1 + refCols.length + editCols.length + 1;

  return (
    <Card className="overflow-hidden">
      {/* Header — reference/edit labels line up with each data column; batch actions on the right. */}
      <div
        className="grid items-end gap-3 border-b border-line bg-[#fafaf7] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <span>Motor</span>
        {refCols.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
        {editCols.map((c) => (
          <span key={c.key}>{c.label}</span>
        ))}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={saveAll}
            disabled={!canSave}
            className={`${W_SAVE} shrink-0 text-center normal-case ${
              pending === "save" ? "text-brass" : canSave ? "text-brass hover:underline" : "cursor-default text-muted opacity-50"
            }`}
          >
            {pending === "save" ? (
              <span className="inline-flex items-center justify-center gap-1.5">
                <Spinner /> Saving…
              </span>
            ) : changedCells.length > 0 ? (
              `Save all (${changedCells.length})`
            ) : (
              "Save all"
            )}
          </button>
          <span className={`${W_RESET} shrink-0 text-left`}>
            {isRetailer && (
              <button
                onClick={resetAll}
                disabled={busy}
                className={`normal-case ${pending === "reset" ? "text-brass" : "text-brass hover:underline disabled:opacity-50"}`}
              >
                {pending === "reset" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner /> …
                  </span>
                ) : (
                  "Reset all"
                )}
              </button>
            )}
          </span>
        </div>
      </div>
      <ul className="divide-y divide-line/70">
        {groups.map((g) => {
          const isCollapsed = collapsed[g.brand];
          return (
            <Fragment key={g.brand}>
              <li className="border-b border-line bg-[#fafaf7]">
                <button
                  type="button"
                  onClick={() => toggleBrand(g.brand)}
                  className="flex w-full items-center gap-2 px-5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted transition-colors hover:bg-[#f3f2ec]"
                >
                  <svg
                    viewBox="0 0 12 12"
                    className={cx("size-3 shrink-0 transition-transform", isCollapsed ? "-rotate-90" : "rotate-0")}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 4.5 6 8l3.5-3.5" />
                  </svg>
                  <span>{g.brand}</span>
                  <span className="font-normal normal-case text-muted/70">· {g.rows.length}</span>
                </button>
              </li>
              {!isCollapsed &&
                g.rows.map((r) => (
                  <Row
                    key={r.modelId}
                    row={r}
                    isRetailer={isRetailer}
                    refCols={refCols}
                    editCols={editCols}
                    gridTemplate={gridTemplate}
                    totalCols={totalCols}
                    getValue={(col) => values[cellKey(r.modelId, col)] ?? ""}
                    onChange={(col, v) => setValue(cellKey(r.modelId, col), v)}
                    hasRowChange={rowChanged(r.modelId).length > 0}
                    onSave={() => saveRow(r.modelId)}
                    onReset={() => resetRow(r.modelId)}
                  />
                ))}
            </Fragment>
          );
        })}
      </ul>
    </Card>
  );
}

function Row({
  row,
  isRetailer,
  refCols,
  editCols,
  gridTemplate,
  totalCols,
  getValue,
  onChange,
  hasRowChange,
  onSave,
  onReset,
}: {
  row: PriceRow;
  isRetailer: boolean;
  refCols: Col[];
  editCols: Col[];
  gridTemplate: string;
  totalCols: number;
  getValue: (col: ColKey) => string;
  onChange: (col: ColKey, v: string) => void;
  hasRowChange: boolean;
  onSave: () => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowHasCustom = editCols.some((c) => hasCustom(row, c.key));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid items-center gap-3 px-5 py-3" style={{ gridTemplateColumns: gridTemplate }}>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-ink">{row.name}</div>
        <div className="truncate text-[11px] text-muted">
          {row.category} · <span className="font-mono">{row.sku}</span>
          {isRetailer && rowHasCustom && <span className="ml-1.5 text-brass">· custom</span>}
        </div>
      </div>
      {refCols.map((c) => (
        <div key={c.key} className="text-[13px] tabular-nums text-muted">
          {usd(refValue(row, c.key))}
        </div>
      ))}
      {editCols.map((c) => (
        <div key={c.key} className={`${W_INPUT} flex items-center rounded-lg border border-line bg-surface px-2`}>
          <span className="text-xs text-muted">$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={getValue(c.key)}
            onChange={(e) => onChange(c.key, e.target.value)}
            className="w-full min-w-0 bg-transparent px-1 py-1.5 text-sm text-ink outline-none"
          />
        </div>
      ))}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="primary"
          busy={busy}
          disabled={!hasRowChange}
          className={`${W_SAVE} shrink-0 py-1.5 text-[12px]`}
          onClick={() => run(onSave)}
        >
          Save
        </Button>
        <span className={`${W_RESET} shrink-0 text-left`}>
          {isRetailer && rowHasCustom && (
            <button
              onClick={() => run(onReset)}
              disabled={busy}
              title="Reset to inherited price"
              className="text-[11px] font-medium text-muted hover:text-brass"
            >
              Reset
            </button>
          )}
        </span>
      </div>
      {error && (
        <span className="text-[11px] text-red-500" style={{ gridColumn: `1 / ${totalCols + 1}` }}>
          {error}
        </span>
      )}
    </li>
  );
}
