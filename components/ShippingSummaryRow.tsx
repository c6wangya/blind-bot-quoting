"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usd } from "@/lib/format";
import { useShippingRecalc } from "./ShippingRecalcContext";
import { useToast } from "./Toast";
import { cx, Spinner } from "./ui";

export type ShipLine = { name: string; qty: number; unit: number; total: number };
type Waiver = "none" | "threshold" | "retailer";
type ExpediteStatus = "none" | "requested" | "quoted";

/**
 * The "Shipping" line in a quote summary, with a click-to-expand per-item breakdown of the base
 * ground shipping. Expedited shipping is admin-priced (migration 0026): the customer *requests* it
 * here, we send a price via support chat, and once quoted the flat fee shows as its own line and
 * folds into the total. Mode (FOB/Ground) is per-motor (admin-set) and not customer-editable.
 */
export function ShippingSummaryRow({
  quoteId,
  editable,
  amount,
  waiver,
  hasGround,
  hasFob,
  leadDays,
  lines,
  expediteStatus,
  expediteFee,
}: {
  quoteId: number;
  editable: boolean;
  amount: number;
  waiver: Waiver;
  hasGround: boolean;
  hasFob: boolean;
  leadDays: number | null;
  lines: ShipLine[];
  expediteStatus: ExpediteStatus;
  expediteFee: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { pending: busy, setPending: setBusy } = useShippingRecalc();
  const [open, setOpen] = useState(false);
  const canExpand = hasGround && lines.length > 0;
  const rawTotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;

  // Optimistic checkbox: reflect the click immediately and disable until saved (re-sync, during
  // render, when the server sends a fresh status).
  const requested = expediteStatus !== "none";
  const [checked, setChecked] = useState(requested);
  const [seen, setSeen] = useState(requested);
  if (seen !== requested) {
    setSeen(requested);
    setChecked(requested);
  }

  const toggleExpedite = async (next: boolean) => {
    setChecked(next); // optimistic
    setBusy(true);
    try {
      const r = await fetch(`/api/quotes/${quoteId}/expedite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next ? "request" : "cancel" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
      router.refresh();
    } catch (e) {
      setChecked(!next); // roll back
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const value = !hasGround ? (
    <span className="text-muted">FOB — you arrange</span>
  ) : amount > 0 ? (
    `+${usd(amount)}`
  ) : waiver === "retailer" ? (
    <span className="text-emerald-600">Waived</span>
  ) : waiver === "threshold" ? (
    <span className="text-emerald-600">Free (over $1,000)</span>
  ) : (
    usd(0)
  );

  return (
    <>
      <div className="flex justify-between">
        <dt className="text-muted">
          <button
            type="button"
            disabled={!canExpand}
            onClick={() => setOpen((v) => !v)}
            className={cx("inline-flex items-center gap-1", canExpand && "hover:text-ink")}
          >
            Shipping
            {canExpand && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cx("size-4 transition-transform", open && "rotate-180")}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            )}
          </button>
        </dt>
        <dd className="font-medium tabular-nums text-ink-soft">{value}</dd>
      </div>

      {open && canExpand && (
        <div className="space-y-1 rounded-md bg-[#faf9f5] px-2.5 py-2 text-[11.5px] text-muted">
          {lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="truncate">
                {l.name} <span className="text-muted/70">· {l.qty} × {usd(l.unit)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{usd(l.total)}</span>
            </div>
          ))}
          {waiver !== "none" && rawTotal > 0 && (
            <div className="flex justify-between gap-3 border-t border-line/60 pt-1 text-emerald-600">
              <span>{waiver === "threshold" ? "Waived (over $1,000)" : "Waived for this account"}</span>
              <span className="shrink-0 tabular-nums">−{usd(rawTotal)}</span>
            </div>
          )}
        </div>
      )}

      {/* Quoted expedite fee folds into the total as its own line. */}
      {expediteStatus === "quoted" && expediteFee != null && (
        <div className="flex justify-between">
          <dt className="text-muted">Expedited shipping</dt>
          <dd className="font-medium tabular-nums text-ink-soft">+{usd(expediteFee)}</dd>
        </div>
      )}

      {hasGround && leadDays != null && (
        <div className="-mt-1 text-[11px] text-muted">
          {expediteStatus === "quoted" ? "Expedited · " : ""}US-made items · est. arrival ≈ {leadDays} business days
          {hasFob && " · China-made items ship FOB (freight arranged by you)"}
        </div>
      )}

      {hasGround && <div className="-mt-1 text-[11px] text-muted">Not available to Alaska or Hawaii.</div>}

      {(editable || requested) && hasGround && (
        <div>
          <label className={cx("flex items-center gap-2 text-[12px] text-ink-soft", editable && "cursor-pointer")}>
            <input
              type="checkbox"
              checked={checked}
              disabled={busy || !editable}
              onChange={(e) => toggleExpedite(e.target.checked)}
              className="size-4 rounded border-line accent-ink disabled:opacity-60"
            />
            <span>Request expedited shipping</span>
            {busy && <Spinner className="text-brass" />}
          </label>
          {checked && expediteStatus === "requested" && (
            <div className="mt-1 pl-6 text-[11px] text-brass">Requested — we&apos;ll send you a price shortly.</div>
          )}
          {checked && expediteStatus === "quoted" && (
            <div className="mt-1 pl-6 text-[11px] text-muted">Quoted by our team — included in the total above.</div>
          )}
        </div>
      )}
    </>
  );
}
