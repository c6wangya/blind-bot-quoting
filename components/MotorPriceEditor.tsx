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
  /** This retailer's price (tier='default') — set directly or synced to Business, or null if unset. */
  overridePrice: number | null;
  /** Seed for the single editable input on the Default / shared-Business screens. */
  currentPrice: number;
  /** Internal purchase/cost price (admin-only). Editable on the Cost screen; NULL → 0 seed. */
  costPrice: number;
  hasOverride: boolean;
};
export type Target =
  // The shared pricing set — cost / default / business edited side by side on one screen.
  | { kind: "set" }
  | { kind: "retailer"; retailerId: string; label: string };

// A price column — either a read-only reference or an editable tier.
type ColKey = "default" | "business" | "override" | "cost";
type Col = { key: ColKey; label: string };

const REF_W = 96; // read-only reference column
const PB_W = 132; // personal-business action column
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
    : []; // the "set" screen makes all three tiers editable, so no read-only reference columns

const editColsFor = (t: Target): Col[] =>
  t.kind === "retailer"
    ? [{ key: "override", label: "This retailer" }]
    : [
        { key: "cost", label: "Cost" },
        { key: "default", label: "Default" },
        { key: "business", label: "Business" },
      ];

const cellKey = (modelId: string, col: ColKey) => `${modelId}::${col}`;

/** The value an editable column's input is pre-filled with — the price currently in effect there,
 *  so an un-set cell shows the value it inherits and stays un-set until the admin edits it. */
function seedFor(row: PriceRow, col: ColKey): number {
  switch (col) {
    case "default":
      return row.defaultPrice;
    case "business":
      return row.businessPrice;
    case "override":
      return row.overridePrice ?? row.defaultPrice;
    case "cost":
      return row.costPrice;
  }
}

const refValue = (row: PriceRow, col: ColKey) => (col === "business" ? row.businessPrice : row.defaultPrice);

/** Build the POST body that persists one editable price cell. */
function bodyFor(col: ColKey, modelId: string, price: number, retailerId?: string): unknown {
  switch (col) {
    case "override":
      return { modelId, retailerId, price };
    case "business":
      return { modelId, price, tier: "business" };
    case "cost":
      return { modelId, price, tier: "cost" };
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
 * Admin: edit motor prices. The shared "set" screen edits Cost / Default / Business side by side for
 * each product. The per-retailer screen shows Default / Global-business reference columns, a one-click
 * "Sync business" button that sets this retailer's price to the Business price, and the editable
 * This-retailer price.
 */
export function MotorPriceEditor({ target, rows }: { target: Target; rows: PriceRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const isRetailer = target.kind === "retailer";
  const retailerId = isRetailer ? target.retailerId : undefined;

  const refCols = refColsFor(target);
  const editCols = editColsFor(target);
  const gridTemplate = [
    "minmax(0,1fr)",
    ...refCols.map(() => `${REF_W}px`),
    ...(isRetailer ? [`${PB_W}px`] : []),
    ...editCols.map(() => `${INPUT_W}px`),
    "auto",
  ].join(" ");

  const seedValues = (rs: PriceRow[]) =>
    Object.fromEntries(
      rs.flatMap((r) => editCols.map((c) => [cellKey(r.modelId, c.key), String(seedFor(r, c.key))]))
    ) as Record<string, string>;
  const seedBaseline = (rs: PriceRow[]) =>
    Object.fromEntries(
      rs.flatMap((r) => editCols.map((c) => [cellKey(r.modelId, c.key), seedFor(r, c.key)]))
    ) as Record<string, number>;

  const [pending, setPending] = useState<"save" | "reset" | null>(null);
  const busy = pending !== null;
  const [values, setValues] = useState<Record<string, string>>(() => seedValues(rows));
  const setValue = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }));

  // Re-baseline whenever the server sends fresh rows (e.g. after a save or a personal-business sync).
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

  // Clear this retailer's price for one product, so it falls back to Default (retailer only).
  const resetRow = async (row: PriceRow) => {
    if (row.overridePrice != null) await post({ retailerId, modelId: row.modelId, reset: true, tier: "default" });
    router.refresh();
  };

  // Set this retailer's price for one product to the current Business price — or, if it already
  // equals it, clear it back to Default (toggle). Writes the override so it shows in "This retailer".
  const syncBusiness = async (row: PriceRow) => {
    if (row.overridePrice != null && row.overridePrice === row.businessPrice) {
      await post({ retailerId, modelId: row.modelId, reset: true, tier: "default" });
    } else {
      await post({ modelId: row.modelId, retailerId, price: row.businessPrice });
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
          c.key === "override"
            ? { retailerId, prices }
            : c.key === "business"
              ? { tier: "business", prices }
              : c.key === "cost"
                ? { tier: "cost", prices }
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

  const totalCols = 1 + refCols.length + (isRetailer ? 1 : 0) + editCols.length + 1;

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
        {isRetailer && <span>Sync business</span>}
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
                    onReset={() => resetRow(r)}
                    onSyncBusiness={() => syncBusiness(r)}
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
  onSyncBusiness,
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
  onSyncBusiness: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [pbBusy, setPbBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rowHasCustom = row.overridePrice != null;
  const pbSynced = row.overridePrice != null && row.overridePrice === row.businessPrice;

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

  const runPb = async () => {
    setPbBusy(true);
    setError(null);
    try {
      await onSyncBusiness();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPbBusy(false);
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
      {isRetailer && (
        <div>
          <button
            type="button"
            onClick={runPb}
            disabled={pbBusy}
            title={
              pbSynced
                ? "This retailer is on the Business price — click to clear"
                : "Set this retailer's price to the Business price"
            }
            className={cx(
              "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50",
              pbSynced
                ? "border border-brass/40 bg-brass/10 text-brass hover:bg-brass/15"
                : "border border-line bg-surface text-ink-soft hover:bg-[#faf9f5]"
            )}
          >
            {pbBusy ? (
              <Spinner />
            ) : pbSynced ? (
              <>
                <svg viewBox="0 0 12 12" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.5 5 9l4.5-5.5" />
                </svg>
                {usd(row.businessPrice)}
              </>
            ) : (
              "Sync business"
            )}
          </button>
        </div>
      )}
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
