"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { BankInfo } from "@/lib/db";
import type { PaymentMethod, PaymentStatus } from "@/lib/types";
import { Badge, Button, Card, cx } from "./ui";

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
  isAdmin,
  bankInfo,
  proofUrl,
}: {
  orderId: number;
  method: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  amountLabel: string;
  isAdmin: boolean;
  bankInfo: BankInfo | null;
  proofUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payWithCard = async () => {
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

  const confirmBankPayment = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/orders/${orderId}/confirm-payment`, { method: "POST", body: fd });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not confirm payment");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
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

      {/* Bank transfer — retailer sees where to pay; admin uploads the receipt to confirm. */}
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
              {isAdmin ? "Set the company bank details under Admin · Settings." : "Bank details are being set up — please contact us."}
            </p>
          )}

          {isAdmin ? (
            <div className="mt-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) confirmBankPayment(f);
                }}
              />
              <Button variant="primary" busy={busy} className="py-2" onClick={() => fileRef.current?.click()}>
                {busy ? "Uploading…" : "Upload receipt & confirm payment"}
              </Button>
              <p className="mt-1.5 text-[11px] text-muted">A receipt (image/PDF) is required to confirm and submit the order.</p>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-ink-soft">
              Once we receive your transfer we&apos;ll confirm it here and the order moves into production.
            </p>
          )}
        </div>
      )}

      {/* Card (Stripe) awaiting or failed — pay / retry via hosted Checkout. */}
      {method === "stripe" && awaiting && (
        <div className="mt-3">
          <p className="mb-2 text-[12.5px] text-ink-soft">
            {paymentStatus === "failed" ? "The last payment attempt didn't go through." : "Complete your card payment to place this order."}
          </p>
          {!isAdmin && (
            <Button variant="primary" busy={busy} className="py-2" onClick={payWithCard}>
              {paymentStatus === "failed" ? "Retry card payment" : "Pay with card"}
            </Button>
          )}
        </div>
      )}

      {/* PayPal — wired in a later phase. */}
      {method === "paypal" && awaiting && (
        <p className="mt-3 text-[12.5px] text-ink-soft">Awaiting PayPal payment.</p>
      )}

      {/* Paid */}
      {paymentStatus === "paid" && proofUrl && (
        <a href={proofUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[12.5px] font-medium text-brass hover:underline">
          View payment receipt →
        </a>
      )}

      {err && <p className="mt-2 text-[12px] text-red-500">{err}</p>}
    </Card>
  );
}
