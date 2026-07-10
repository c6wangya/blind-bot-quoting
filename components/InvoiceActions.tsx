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
 * Auto-run the "Confirm & pay" flow when the invoice is opened from a "Payment Options" deep link
 * (`/invoices/[id]?pay=paypal|stripe|bank_transfer`). Those links live in the invoice sheet, so they
 * work from a downloaded PDF — clicking one is exactly like scrolling up, opening the picker,
 * choosing that method, and pressing the primary button:
 *   • Draft quote (not yet ordered) → submit it with the chosen method (place the order), which
 *     forwards to the gateway — same as SubmitPreOrderButton's "Place order".
 *   • Already has an awaiting-payment order → switch its method and forward to the gateway — same as
 *     InvoicePayPicker's "Confirm".
 * Bank transfer has no gateway: it reloads the invoice (now converted) to reveal the wire details.
 * Nothing payable (already paid, or no submittable quote) → renders nothing and the page loads as usual.
 */
export function InvoiceAutoPay({
  method,
  orderId,
  quoteId,
  canSubmit,
  token,
}: {
  method: PaymentMethod | null;
  /** an existing awaiting-payment order to pay, or null when the quote hasn't been ordered yet */
  orderId: number | null;
  /** the draft quote to place + pay when there's no order yet */
  quoteId: number;
  /** the "Confirm & pay" (submit) flow is available: draft, unpaid, no order yet */
  canSubmit: boolean;
  token: string;
}) {
  const active = !!method && (!!orderId || canSubmit);
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (started.current || !active) return;
    started.current = true; // guard against Strict Mode's double-invoke (avoids a double POST)
    setRedirecting(true);

    const authHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (token) authHeaders["x-invoice-token"] = token;

    // Bank transfer has no gateway hop: drop the ?pay flag and reload to the TOP with the "Pay this
    // invoice" picker open (?openpay=1) so the next step is right there (confirm bank transfer, or
    // switch method). The wire details stay listed at the bottom of the invoice for reference.
    const stripPayAndReload = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("pay");
      url.hash = "";
      url.searchParams.set("openpay", "1");
      window.location.assign(url.toString());
    };

    (async () => {
      try {
        if (orderId) {
          // Existing awaiting-payment order — switch its method, then pay (InvoicePayPicker flow).
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
            stripPayAndReload();
            return;
          }
          const r = await fetch(`/api/orders/${orderId}/pay`, { method: "POST", headers: authHeaders });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error ?? "Could not start payment");
          window.location.assign(data.url); // gateway hand-off (PayPal / Stripe)
          return;
        }
        // Draft quote — place the order with the chosen method (SubmitPreOrderButton's flow).
        const r = await fetch(`/api/quotes/${quoteId}/submit`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ method }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? "Could not place the order");
        if (data.redirect) {
          window.location.href = data.redirect; // gateway hand-off (PayPal / Stripe)
          return;
        }
        stripPayAndReload(); // bank transfer: converted, no gateway
      } catch (e) {
        setError((e as Error).message);
        setRedirecting(false);
      }
    })();
  }, [active, method, orderId, quoteId, token]);

  if (!active || !method) return null;
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
  autoOpen = false,
}: {
  orderId: number;
  token: string;
  currentMethod: PaymentMethod | null;
  amountLabel: string;
  /** Start expanded — used when bank transfer couldn't complete on-page (?openpay=1). */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
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
