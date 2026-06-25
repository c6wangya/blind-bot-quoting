"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";

/**
 * "Print / Save as PDF" — the browser's print dialog doubles as a PDF export. The suggested
 * "Save as PDF" filename comes from document.title, so we set it to the seller + invoice number
 * (e.g. "Loom & Shade INV2026061902"). Set on mount so it applies to native Cmd+P too, and
 * restored on unmount so it doesn't leak to other pages.
 */
export function PrintInvoiceButton({ fileName }: { fileName?: string }) {
  useEffect(() => {
    if (!fileName) return;
    const prev = document.title;
    document.title = fileName;
    return () => {
      document.title = prev;
    };
  }, [fileName]);

  return (
    <Button variant="secondary" onClick={() => window.print()} className="py-2.5">
      Print / Save PDF
    </Button>
  );
}

/**
 * Pay an existing awaiting-payment order from the PUBLIC invoice (Stripe/PayPal). Authorizes with
 * the pay-by-link token and forwards to the gateway. Bank-transfer orders pay offline, so the page
 * shows the bank details instead of this button.
 */
export function InvoicePayOrderButton({ orderId, token, label }: { orderId: number; token: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-invoice-token": token },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not start payment");
      window.location.href = data.url; // gateway hand-off
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="primary" onClick={pay} busy={busy} className="py-2.5">
        {busy ? "Starting…" : label}
      </Button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
