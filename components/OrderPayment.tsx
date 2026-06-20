"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BankInfo } from "@/lib/db";
import type { PaymentMethod, PaymentStatus } from "@/lib/types";
import { Badge, Button, Card, cx } from "./ui";

// Retailer-facing payment panel on the Pre-Orders page. Admin confirmation of a bank transfer
// lives in the Supplier Console (Admin Console), not here.

const METHOD_LABEL: Record<PaymentMethod, string> = {
  stripe: "Card (Stripe)",
  paypal: "PayPal",
  bank_transfer: "Bank transfer",
};

function StatusPill({ status }: { status: PaymentStatus }) {
  const map = { paid: "green", failed: "amber", pending: "slate" } as const;
  const label = { paid: "Paid", failed: "Payment failed", pending: "Awaiting payment" }[status];
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
}: {
  orderId: number;
  method: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  amountLabel: string;
  bankInfo: BankInfo | null;
  proofUrl: string | null;
  transferReported?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payNow = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/pay`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not start payment");
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const reportTransfer = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/report-transfer`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not report transfer");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelOrder = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not cancel order");
      if (data.quoteId) router.push(`/quotes/${data.quoteId}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const awaiting = paymentStatus !== "paid";
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

      {/* Bank transfer — where to pay + "I've made the transfer". Admin confirms in Supplier Console. */}
      {isBank && awaiting && (
        <div className="mt-4">
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
        </div>
      )}

      {/* Card (Stripe) awaiting or failed — pay / retry via hosted Checkout. */}
      {method === "stripe" && awaiting && (
        <div className="mt-3">
          <p className="mb-2 text-[12.5px] text-ink-soft">
            {paymentStatus === "failed" ? "The last payment attempt didn't go through." : "Complete your card payment to place this order."}
          </p>
          <Button variant="primary" busy={busy} className="py-2" onClick={payNow}>
            {paymentStatus === "failed" ? "Retry card payment" : "Pay with card"}
          </Button>
        </div>
      )}

      {/* PayPal — approve via PayPal, captured on return. */}
      {method === "paypal" && awaiting && (
        <div className="mt-3">
          <p className="mb-2 text-[12.5px] text-ink-soft">
            {paymentStatus === "failed" ? "The last payment attempt didn't go through." : "Complete your PayPal payment to place this order."}
          </p>
          <Button variant="primary" busy={busy} className="py-2" onClick={payNow}>
            {paymentStatus === "failed" ? "Retry PayPal" : "Pay with PayPal"}
          </Button>
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

      {/* Cancel an unpaid order — releases reserved stock and reopens the quote for editing. */}
      {awaiting &&
        (confirmCancel ? (
          <div className="mt-4 rounded-lg border border-line bg-[#faf9f5] px-3 py-2 text-[12px]">
            <p className="text-ink-soft">Cancel this order? Your quote reopens for editing and any reserved stock is released.</p>
            <div className="mt-1.5 flex items-center gap-3">
              <button onClick={cancelOrder} disabled={busy} className="font-semibold text-red-600 hover:underline">
                Cancel order
              </button>
              <button onClick={() => setConfirmCancel(false)} disabled={busy} className="text-muted hover:underline">
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmCancel(true)} className="mt-4 text-[11.5px] font-medium text-muted hover:text-red-500">
            Cancel order
          </button>
        ))}

      {err && <p className="mt-2 text-[12px] text-red-500">{err}</p>}
    </Card>
  );
}
