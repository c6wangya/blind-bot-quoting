"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BankInfo } from "@/lib/db";
import type { PaymentMethod, PaymentStatus } from "@/lib/types";
import { useToast } from "./Toast";
import { Badge, Button, Card, cx } from "./ui";

// Retailer-facing payment panel on the Pre-Orders page. Admin confirmation of a bank transfer
// lives in the Supplier Console (Admin Console), not here.

const METHOD_LABEL: Record<PaymentMethod, string> = {
  stripe: "Card (Stripe)",
  paypal: "PayPal",
  bank_transfer: "Bank transfer",
};

// Same options/order as the initial submit flow (see QuoteActions).
const PAYMENT_OPTIONS: { id: PaymentMethod; icon: string; label: string; desc: string }[] = [
  { id: "stripe", icon: "💳", label: "Card (Stripe)", desc: "Pay by credit or debit card" },
  { id: "paypal", icon: "🅿️", label: "PayPal", desc: "Pay with your PayPal account" },
  { id: "bank_transfer", icon: "🏦", label: "Bank transfer", desc: "Wire to our account" },
];

function StatusPill({ status }: { status: PaymentStatus }) {
  const map = { paid: "green", failed: "amber", pending: "slate", refunded: "slate", partially_refunded: "amber" } as const;
  const label = {
    paid: "Paid",
    failed: "Payment failed",
    pending: "Awaiting payment",
    refunded: "Refunded",
    partially_refunded: "Partially refunded",
  }[status];
  return <Badge tone={map[status]}>{label}</Badge>;
}

const ROW: { key: keyof BankInfo; label: string }[] = [
  { key: "bankName", label: "Bank" },
  { key: "accountName", label: "Account holder" },
  { key: "accountNumber", label: "Account №" },
  { key: "routingNumber", label: "Routing / ABA" },
  { key: "swift", label: "SWIFT / BIC" },
];

export function OrderPayment({
  orderId,
  method,
  paymentStatus,
  amountLabel,
  bankInfo,
  proofUrl,
  transferReported = false,
  refundedLabel,
  netLabel,
}: {
  orderId: number;
  method: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  amountLabel: string;
  bankInfo: BankInfo | null;
  proofUrl: string | null;
  transferReported?: boolean;
  /** Total refunded so far (formatted); when present, shows a "Refunded −X · Net Y" breakdown. */
  refundedLabel?: string;
  netLabel?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  // The method highlighted in the chooser — committed only when the user presses Confirm.
  const [selected, setSelected] = useState<PaymentMethod>(method ?? "stripe");
  const openChooser = () => {
    setSelected(method ?? "stripe");
    setChoosing(true);
  };

  // Pay via a gateway: switch the order to that method first (if changed), then start checkout.
  // /pay reads the order's method from the DB, so the switch must land before we call it.
  const payWith = async (m: PaymentMethod) => {
    setBusy(true);
    setErr(null);
    try {
      if (m !== method) {
        const rs = await fetch(`/api/orders/${orderId}/payment-method`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: m }),
        });
        const ds = await rs.json().catch(() => ({}));
        if (!rs.ok) throw new Error(ds.error ?? "Could not change payment method");
      }
      const r = await fetch(`/api/orders/${orderId}/pay`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not start payment");
      if (data.url) window.location.assign(data.url);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  // Pick a method from the chooser: gateways jump straight to checkout; bank transfer just
  // switches the order (the panel then shows the wire instructions).
  const chooseMethod = (m: PaymentMethod) => {
    setChoosing(false);
    if (m === "bank_transfer") {
      if (m !== method) switchMethod(m);
    } else {
      payWith(m);
    }
  };

  const reportTransfer = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/report-transfer`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not report transfer");
      toast("Thanks — we'll confirm your transfer shortly");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const switchMethod = async (next: PaymentMethod) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/payment-method`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: next }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not change payment method");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Only pending/failed orders are still "awaiting" — a (partially) refunded order has been paid.
  const awaiting = paymentStatus === "pending" || paymentStatus === "failed";
  const isBank = method === "bank_transfer";
  const bankReady = !!(bankInfo && bankInfo.bankName && bankInfo.accountNumber);

  return (
    <Card className={cx("px-5 py-5", awaiting && "border-amber-300 bg-amber-50/40")}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Payment</h3>
        <StatusPill status={paymentStatus} />
      </div>
      <div className="mt-2 flex items-baseline gap-3 text-[13px] text-ink-soft">
        <span>
          Method: <span className="font-medium text-ink">{method ? METHOD_LABEL[method] : "—"}</span>
        </span>
        <span>
          Amount: <span className="font-semibold tabular-nums text-ink">{amountLabel}</span>
        </span>
      </div>
      {refundedLabel && netLabel && (
        <div className="mt-2 flex flex-col gap-0.5 border-t border-line pt-2 text-[13px]">
          <div className="flex justify-between text-ink-soft">
            <span>Refunded</span>
            <span className="tabular-nums text-emerald-600">−{refundedLabel}</span>
          </div>
          <div className="flex justify-between font-semibold text-ink">
            <span>Net paid</span>
            <span className="tabular-nums">{netLabel}</span>
          </div>
        </div>
      )}

      {/* Awaiting payment — bank transfer shows wire instructions; gateways show a Pay button that
          opens the method chooser (same pattern as the initial submit flow). */}
      {awaiting && !choosing && (
        <div className="mt-4">
          {isBank ? (
            <>
              {bankReady ? (
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Transfer {amountLabel} to</div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                    {ROW.filter((r) => bankInfo![r.key]).map((r) => (
                      <div key={r.key} className="contents">
                        <dt className="text-muted">{r.label}</dt>
                        <dd className="font-medium text-ink">{bankInfo![r.key]}</dd>
                      </div>
                    ))}
                  </dl>
                  {bankInfo!.instructions && <p className="mt-2 text-[12px] text-ink-soft">{bankInfo!.instructions}</p>}
                </div>
              ) : (
                <p className="rounded-xl border border-line bg-surface p-3 text-[12.5px] text-muted">
                  Bank details are being set up — please contact us.
                </p>
              )}

              {transferReported ? (
                <p className="mt-3 text-[12.5px] font-medium text-emerald-700">
                  ✓ Transfer reported — we&apos;ll confirm here once the funds arrive and move your order forward.
                </p>
              ) : (
                <div className="mt-3">
                  <Button variant="primary" busy={busy} className="py-2" onClick={reportTransfer} disabled={!bankReady}>
                    I&apos;ve made the transfer
                  </Button>
                  <p className="mt-1.5 text-[11px] text-muted">
                    Click after you&apos;ve sent the wire — we&apos;ll confirm receipt and move your order forward.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={openChooser}
                className="mt-3 block text-[12px] font-medium text-brass hover:underline"
              >
                Change payment method
              </button>
            </>
          ) : (
            <>
              {paymentStatus === "failed" && (
                <p className="mb-2 text-[12.5px] text-ink-soft">The last payment attempt didn&apos;t go through.</p>
              )}
              <Button variant="primary" busy={busy} className="py-2.5" onClick={openChooser}>
                {paymentStatus === "failed" ? "Retry payment" : "Pay"} · {amountLabel}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Payment method chooser — same card as the initial "Submit pre-order" flow. */}
      {awaiting && choosing && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
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
                {opt.id === method && <span className="text-[11px] font-medium text-brass">Current</span>}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setChoosing(false)} disabled={busy} className="py-2">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => chooseMethod(selected)} busy={busy} className="py-2">
              Confirm
            </Button>
          </div>
        </div>
      )}

      {/* Paid — show the bank receipt as a viewable attachment */}
      {paymentStatus === "paid" && proofUrl && (
        <a
          href={proofUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] hover:border-ink"
        >
          <span className="text-base">📎</span>
          <span className="font-medium text-ink underline">Payment receipt</span>
          <span className="text-muted">— view</span>
        </a>
      )}

      {/* Cancel (unpaid) now lives in the order header next to Refund — see CancelOrderButton. */}

      {err && <p className="mt-2 text-[12px] text-red-500">{err}</p>}
    </Card>
  );
}
