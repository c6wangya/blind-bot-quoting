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
  defaultPrice: number;
  /** Shared Business-tier price (falls back to default when the model has no business row).
   *  Shown as a read-only reference column on the per-retailer override screen. */
  businessPrice: number;
  currentPrice: number;
  hasOverride: boolean;
};
export type Target =
  | { kind: "default" }
  | { kind: "business" }
  | { kind: "retailer"; retailerId: string; label: string };

// Shared grid + sub-column widths so the header labels/actions line up with each data row's
// input / Save / Reset. Keep these three in lockstep with the slot widths below. The retailer
// screen adds a read-only "Business" reference column (Default | Business | This retailer).
const gridClass = (showBusiness: boolean) =>
  `grid ${showBusiness ? "grid-cols-[1fr_120px_120px_256px]" : "grid-cols-[1fr_120px_256px]"} gap-3 px-5`;
const W_INPUT = "w-24"; // price input box — "This retailer" header sits above it
const W_SAVE = "w-20"; //  Save button   — "Save all" header sits above it
const W_RESET = "w-14"; // Reset button  — "Reset all" header sits above it

const post = async (body: unknown) => {
  const r = await fetch("/api/motors/prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
};

/** Admin: edit motor prices for the Default tier, or override them for one retailer. */
export function MotorPriceEditor({ target, rows }: { target: Target; rows: PriceRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const isRetailer = target.kind === "retailer";
  const isBusiness = target.kind === "business";
  // On the per-retailer screen, show the shared Business tier as a read-only reference column.
  const showBusiness = isRetailer;
  const retailerId = isRetailer ? target.retailerId : undefined;
  // Which batch action is in flight — so "Save all" and "Reset all" each show their own spinner
  // rather than both lighting up off a shared boolean.
  const [pending, setPending] = useState<"save" | "reset" | null>(null);
  const busy = pending !== null;
  // Edited input values live here (not in each Row) so "Save all" can submit them together.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.modelId, String(r.currentPrice)]))
  );
  const setValue = (modelId: string, v: string) => setValues((prev) => ({ ...prev, [modelId]: v }));

  // The price each row is diffed against. Seeded from props, updated optimistically on save so the
  // button settles straight to "nothing to save" without a flash of the enabled state while
  // router.refresh() round-trips. Re-synced (during render) whenever the server sends fresh rows.
  const seed = () => Object.fromEntries(rows.map((r) => [r.modelId, r.currentPrice]));
  const [baseline, setBaseline] = useState<Record<string, number>>(seed);
  const [seenRows, setSeenRows] = useState(rows);
  if (seenRows !== rows) {
    setSeenRows(rows);
    setBaseline(seed());
    // Re-seed the input boxes too so they follow the server's effective price — e.g. when the
    // Business-pricing toggle flips, un-overridden rows should snap to Business/Default here.
    setValues(Object.fromEntries(rows.map((r) => [r.modelId, String(r.currentPrice)])));
  }

  // A row is "changed" when its (valid) input differs from the price currently in effect.
  const changed = rows.filter((r) => {
    const n = Number(values[r.modelId]);
    return Number.isFinite(n) && n >= 0 && n !== (baseline[r.modelId] ?? r.currentPrice);
  });
  const canSave = !busy && changed.length > 0;

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

  // Collapse/expand each brand section (all expanded by default).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleBrand = (brand: string) => setCollapsed((c) => ({ ...c, [brand]: !c[brand] }));

  const resetAll = async () => {
    if (!isRetailer) return;
    setPending("reset");
    try {
      await post({ retailerId, reset: true });
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPending(null);
    }
  };

  const saveAll = async () => {
    if (changed.length === 0) return;
    setPending("save");
    try {
      await post({
        ...(retailerId ? { retailerId } : {}),
        ...(isBusiness ? { tier: "business" } : {}),
        prices: changed.map((r) => ({ modelId: r.modelId, price: Number(values[r.modelId]) })),
      });
      // Re-baseline what we just persisted → changed drops to 0 immediately (no enabled flash).
      setBaseline((b) => {
        const next = { ...b };
        for (const r of changed) next[r.modelId] = Number(values[r.modelId]);
        return next;
      });
      toast(`Saved ${changed.length} price${changed.length === 1 ? "" : "s"}`);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      {/* Header — column labels on the left; batch actions sit directly above their row columns. */}
      <div
        className={`${gridClass(showBusiness)} items-center border-b border-line bg-[#fafaf7] py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted`}
      >
        <span>Motor</span>
        <span>{target.kind === "default" ? "Price" : "Default"}</span>
        {showBusiness && <span>Business</span>}
        <div className="flex items-center justify-end gap-2">
          <span className={`${W_INPUT} shrink-0 text-left`}>
            {isRetailer ? "This retailer" : isBusiness ? "Business" : ""}
          </span>
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
            ) : changed.length > 0 ? (
              `Save all (${changed.length})`
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
                    target={target}
                    showBusiness={showBusiness}
                    value={values[r.modelId] ?? ""}
                    onChange={(v) => setValue(r.modelId, v)}
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
  target,
  showBusiness,
  value,
  onChange,
}: {
  row: PriceRow;
  target: Target;
  showBusiness: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  const router = useRouter();
  const isRetailer = target.kind === "retailer";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await post(body);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0) {
      setError("Enter a valid price");
      return;
    }
    run(
      isRetailer
        ? { modelId: row.modelId, retailerId: (target as { retailerId: string }).retailerId, price }
        : target.kind === "business"
          ? { modelId: row.modelId, price, tier: "business" }
          : { modelId: row.modelId, price }
    );
  };

  return (
    <li className={`${gridClass(showBusiness)} items-center py-3`}>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-ink">{row.name}</div>
        <div className="truncate text-[11px] text-muted">
          {row.category} · <span className="font-mono">{row.sku}</span>
          {isRetailer && row.hasOverride && <span className="ml-1.5 text-brass">· custom</span>}
        </div>
      </div>
      <div className="text-[13px] tabular-nums text-muted">{usd(row.defaultPrice)}</div>
      {showBusiness && <div className="text-[13px] tabular-nums text-muted">{usd(row.businessPrice)}</div>}
      <div className="flex items-center justify-end gap-2">
        <div className={`${W_INPUT} flex shrink-0 items-center rounded-lg border border-line bg-surface px-2`}>
          <span className="text-xs text-muted">$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full min-w-0 bg-transparent px-1 py-1.5 text-sm text-ink outline-none"
          />
        </div>
        <Button variant="primary" busy={busy} className={`${W_SAVE} shrink-0 py-1.5 text-[12px]`} onClick={save}>
          Save
        </Button>
        {/* Reset slot is always reserved (shrink-0) so input + Save stay aligned across all rows. */}
        <span className={`${W_RESET} shrink-0 text-left`}>
          {isRetailer && row.hasOverride && (
            <button
              onClick={() => run({ retailerId: (target as { retailerId: string }).retailerId, modelId: row.modelId, reset: true })}
              disabled={busy}
              title="Reset to default"
              className="text-[11px] font-medium text-muted hover:text-brass"
            >
              Reset
            </button>
          )}
        </span>
      </div>
      {error && <span className={`${showBusiness ? "col-span-4" : "col-span-3"} text-[11px] text-red-500`}>{error}</span>}
    </li>
  );
}
