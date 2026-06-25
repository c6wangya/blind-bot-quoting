"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GROUND_LEAD_DAYS } from "@/lib/shipping";
import { useToast } from "./Toast";
import { Card, Spinner } from "./ui";

/**
 * Retailer-facing expedite request on a draft quote. Only shown when the quote has US-made (ground)
 * motor lines — the FOB/Ground mode itself is set per-motor by an admin and is not customer-editable.
 * Posts to the quote and refreshes so the summary re-prices server-side.
 */
export function QuoteShippingPicker({ quoteId, expedite }: { quoteId: number; expedite: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const setExpedite = async (next: boolean) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/quotes/${quoteId}/shipping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expedite: next }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="px-5 py-4">
      <div className="text-sm font-semibold text-ink">Shipping</div>
      <p className="mt-1 text-[12px] leading-snug text-muted">
        US-made items ship domestic ground (est. ≈ {GROUND_LEAD_DAYS} business days). China-made items
        ship FOB — you arrange freight.
      </p>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft">
        <input
          type="checkbox"
          checked={expedite}
          disabled={busy}
          onChange={(e) => setExpedite(e.target.checked)}
          className="size-4 rounded border-line accent-ink"
        />
        <span>
          Request expedited shipping <span className="text-muted">(faster; premium rate, always charged)</span>
        </span>
        {busy && <Spinner className="text-brass" />}
      </label>
    </Card>
  );
}
