"use client";

import { useEffect, useRef, useState } from "react";
import { Button, cx } from "./ui";
import type { PaymentMethod } from "@/lib/types";

const PAYMENT_OPTIONS: { id: PaymentMethod; icon: string; label: string; desc: string }[] = [
  { id: "stripe", icon: "💳", label: "Card (Stripe)", desc: "Pay by credit or debit card" },
  { id: "paypal", icon: "🅿️", label: "PayPal", desc: "Pay with your PayPal account" },
  { id: "bank_transfer", icon: "🏦", label: "Bank transfer", desc: "Wire to our account" },
];

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

const METHOD_LABEL: Record<PaymentMethod, string> = {
  paypal: "PayPal",
  stripe: "the card checkout",
  bank_transfer: "your invoice",
};

/**
 * Auto-start a payment when the invoice is opened from a "Payment Options" deep link
 * (`/invoices/[id]?pay=paypal|stripe|bank_transfer`). Those links live in the invoice sheet, so they
 * work from a downloaded PDF: the link opens this page and this component runs the same flow as the
 * picker — switch the order's method, then forward to the gateway (or, for bank transfer, reveal the
 * wire details). No payable order (quote not yet submitted) → renders nothing and the page loads as
 * usual so the visitor can submit first.
 */
export function InvoiceAutoPay({
  method,
  orderId,
  token,
}: {
  method: PaymentMethod | null;
  /** the awaiting-payment order to pay, or null when there's nothing payable yet */
  orderId: number | null;
  token: string;
}) {
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (started.current || !method || !orderId) return;
    started.current = true; // guard against Strict Mode's double-invoke (avoids a double POST)
    setRedirecting(true);

    const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (token) authHeaders["x-invoice-token"] = token;

    (async () => {
      try {
        const rs = await fetch(`/api/orders/${orderId}/payment-method`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ method }),
        });
        if (!rs.ok) {
          const ds = await rs.json().catch(() => ({}));
          throw new Error(ds.error ?? "Could not select this payment method");
        }
        if (method === "bank_transfer") {
          // Drop the ?pay flag and reload so the invoice shows the awaiting status + wire details.
          const url = new URL(window.location.href);
          url.searchParams.delete("pay");
          window.location.assign(url.toString());
          return;
        }
        const r = await fetch(`/api/orders/${orderId}/pay`, { method: "POST", headers: authHeaders });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "Could not start payment");
        window.location.assign(data.url); // gateway hand-off (PayPal / Stripe)
      } catch (e) {
        setError((e as Error).message);
        setRedirecting(false);
      }
    })();
  }, [method, orderId, token]);

  if (!method || !orderId) return null;
  if (!error && !redirecting) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 text-center print:hidden">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl">
        {error ? (
          <>
            <div className="text-[14px] font-semibold text-ink">Couldn&apos;t start payment</div>
            <p className="mt-2 text-[12.5px] text-muted">{error}</p>
            <Button
              variant="secondary"
              className="mt-4 py-2"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.delete("pay");
                window.location.assign(url.toString());
              }}
            >
              Back to invoice
            </Button>
          </>
        ) : (
          <div className="text-[13.5px] font-medium text-ink">Redirecting to {METHOD_LABEL[method]}…</div>
        )}
      </div>
    </div>
  );
}

/**
 * Pay an existing awaiting-payment order from the PUBLIC invoice. Like the portal order page, the
 * payer can freely (re)choose the method on every attempt — so a cancelled PayPal run can be
 * retried as card or bank transfer. Authorizes every call with the pay-by-link token: switches the
 * order's method via /payment-method (if changed), then either forwards to the gateway (/pay) or,
 * for bank transfer, reloads the invoice to reveal the wire details.
 */
export function InvoicePayPicker({
  orderId,
  token,
  currentMethod,
  amountLabel,
}: {
  orderId: number;
  token: string;
  currentMethod: PaymentMethod | null;
  amountLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Highlighted method — committed only when the payer presses Confirm.
  const [selected, setSelected] = useState<PaymentMethod>(currentMethod ?? "stripe");

  const authHeaders = { "Content-Type": "application/json", "x-invoice-token": token };

  const openPicker = () => {
    setSelected(currentMethod ?? "stripe");
    setOpen(true);
  };

  const choose = async (m: PaymentMethod) => {
    setBusy(true);
    setError(null);
    try {
      if (m !== currentMethod) {
        const rs = await fetch(`/api/orders/${orderId}/payment-method`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ method: m }),
        });
        const ds = await rs.json().catch(() => ({}));
        if (!rs.ok) throw new Error(ds.error ?? "Could not change payment method");
      }
      if (m === "bank_transfer") {
        window.location.reload(); // invoice re-renders with the bank-transfer details + status
        return;
      }
      const r = await fetch(`/api/orders/${orderId}/pay`, { method: "POST", headers: authHeaders });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not start payment");
      window.location.assign(data.url); // gateway hand-off
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!open) {
    const isBank = currentMethod === "bank_transfer";
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="primary" onClick={openPicker} className="py-2.5">
          {isBank ? "Pay this invoice →" : `Pay ${amountLabel} →`}
        </Button>
        {isBank && <span className="text-[11px] text-muted">Awaiting bank transfer · or pay another way</span>}
      </div>
    );
  }

  return (
    <div className="w-[300px] rounded-2xl border border-line bg-surface p-4 text-left shadow-sm">
      <div className="mb-3 text-center">
        <div className="text-[13px] font-semibold text-ink">Choose payment method</div>
        <div className="text-[12px] text-muted">Total due · {amountLabel}</div>
      </div>
      <div className="space-y-2">
        {PAYMENT_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => setSelected(opt.id)}
            disabled={busy}
            className={cx(
              "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
              opt.id === selected ? "border-ink bg-[#faf9f5]" : "border-line hover:border-ink hover:bg-[#faf9f5]",
              busy && "opacity-60"
            )}
          >
            <span className="text-xl">{opt.icon}</span>
            <div className="flex-1">
              <div className="text-[13.5px] font-medium text-ink">{opt.label}</div>
              <div className="text-[11.5px] text-muted">{opt.desc}</div>
            </div>
            {opt.id === currentMethod && <span className="text-[11px] font-medium text-brass">Current</span>}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="py-2">
          Cancel
        </Button>
        <Button variant="primary" onClick={() => choose(selected)} busy={busy} className="py-2">
          Confirm
        </Button>
      </div>
      {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
