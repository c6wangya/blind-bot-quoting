"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/types";
import { cx } from "./ui";

const NEXT_ACTION: Partial<Record<OrderStatus, { action: string; label: string }>> = {
  submitted: { action: "acknowledge", label: "Acknowledge + issue order №" },
  acknowledged: { action: "start_production", label: "Start production" },
  in_production: { action: "ship", label: "Ship + issue tracking №" },
  shipped: { action: "in_transit", label: "Mark in transit" },
  in_transit: { action: "deliver", label: "Mark delivered" },
};

const BTN = "rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink shadow-sm transition-all";

export default function SupplierAdvanceButton({
  orderId,
  status,
  paymentMethod,
  paymentStatus,
}: {
  orderId: number;
  status: OrderStatus;
  paymentMethod?: PaymentMethod | null;
  paymentStatus?: PaymentStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- Awaiting payment: admin confirms here (bank transfer needs a receipt) ----
  if (status === "awaiting_payment") {
    if (paymentMethod === "bank_transfer") {
      const confirmPayment = async (file: File) => {
        setBusy(true);
        setError(null);
        try {
          const fd = new FormData();
          fd.append("file", file);
          const r = await fetch(`/api/orders/${orderId}/confirm-payment`, { method: "POST", body: fd });
          if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            throw new Error(data.error ?? "Could not confirm payment");
          }
          router.refresh();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      };
      return (
        <div className="flex items-center justify-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) confirmPayment(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            title="Upload the bank receipt to confirm funds received and submit the order"
            className={cx(BTN, busy ? "opacity-50" : "hover:border-brass hover:text-brass")}
          >
            {busy ? "Uploading…" : "Confirm payment + upload receipt"}
          </button>
          {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>
      );
    }
    // Card / PayPal — gateway-driven; the retailer pays, no admin action here.
    return (
      <span className="text-xs text-muted">{paymentStatus === "failed" ? "Card payment failed" : "Awaiting payment"}</span>
    );
  }

  // ---- Fulfilment advance ----
  const next = NEXT_ACTION[status];
  if (!next) return <span className="text-xs font-medium text-emerald-600">Complete ✓</span>;

  const advance = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/orders/${orderId}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: next.action }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not advance order");
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <button onClick={advance} disabled={busy} className={cx(BTN, busy ? "opacity-50" : "hover:border-brass hover:text-brass")}>
        {busy ? "Syncing…" : next.label + " →"}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
