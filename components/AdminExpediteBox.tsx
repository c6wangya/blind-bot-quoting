"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { usd } from "@/lib/format";
import { useToast } from "./Toast";
import { Card, cx, Spinner } from "./ui";

/**
 * Admin-only control on the quote page to price expedited shipping directly (the same action as the
 * Messages request card). Prefilled with the system reference fee. Visible to admins whenever the
 * quote has ground-shipped items — primary use is when the customer has 'requested' a price.
 */
export function AdminExpediteBox({
  quoteId,
  status,
  refFee,
  currentFee,
}: {
  quoteId: number;
  status: "none" | "requested" | "quoted";
  refFee: number;
  currentFee: number | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [fee, setFee] = useState(currentFee != null ? String(currentFee) : refFee ? String(refFee) : "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const n = Number(fee);
    if (!Number.isFinite(n) || n < 0) {
      toast("Enter a valid fee (0 or more).", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/quotes/${quoteId}/expedite-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee: n }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
      toast("Expedite fee sent to the customer.", "success");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="px-5 py-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">
        <span aria-hidden>⚡</span> Expedited shipping (admin)
      </div>
      <p className="mt-1.5 text-[12px] text-muted">
        {status === "requested"
          ? "Customer requested a price. Set one flat fee — it folds into their total."
          : status === "quoted"
            ? "Currently quoted. Adjust the flat fee if needed."
            : "Set a flat expedite fee for this quote (optional)."}
      </p>
      <p className="mt-1.5 text-[11.5px] text-muted">
        System reference: <span className="font-medium text-ink-soft tabular-nums">{usd(refFee)}</span>
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted">$</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border border-line bg-surface py-2 pl-5 pr-2 text-[13px] tabular-nums text-ink outline-none focus:border-ink disabled:opacity-60"
          />
        </div>
        <button
          onClick={save}
          disabled={busy}
          className={cx(
            "shrink-0 rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition-opacity",
            busy ? "opacity-60" : "hover:opacity-90"
          )}
        >
          {busy ? <Spinner /> : status === "quoted" ? "Update" : "Send quote"}
        </button>
      </div>
    </Card>
  );
}
