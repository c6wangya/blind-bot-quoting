"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/types";
import { Button, cx } from "./ui";

const NEXT_ACTION: Partial<Record<OrderStatus, { action: string; label: string }>> = {
  submitted: { action: "acknowledge", label: "Acknowledge + issue order №" },
  acknowledged: { action: "start_production", label: "Start production" },
  in_production: { action: "ship", label: "Ship + issue tracking №" },
  shipped: { action: "in_transit", label: "Mark in transit" },
  in_transit: { action: "deliver", label: "Mark delivered" },
};

const BTN = "rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink shadow-sm transition-all";

function fmtSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const post = async (url: string, init?: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method: "POST", ...init });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Request failed");
      }
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => post(`/api/orders/${orderId}/cancel`);
  const cancelLink = (
    <button onClick={cancel} disabled={busy} className="text-[11px] font-medium text-muted hover:text-red-500">
      Cancel
    </button>
  );

  const submitReceipt = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const ok = await post(`/api/orders/${orderId}/confirm-payment`, { body: fd });
    if (ok) {
      setConfirmOpen(false);
      setFile(null);
    }
  };

  // ---- Awaiting payment ----
  if (status === "awaiting_payment") {
    const isBank = paymentMethod === "bank_transfer";
    return (
      <div className="flex items-center justify-end gap-2">
        {isBank ? (
          <button onClick={() => setConfirmOpen(true)} disabled={busy} className={cx(BTN, "hover:border-brass hover:text-brass")}>
            Confirm payment
          </button>
        ) : (
          <span className="text-xs text-muted">{paymentStatus === "failed" ? "Card payment failed" : "Awaiting payment"}</span>
        )}
        {cancelLink}
        {error && <span className="text-[11px] text-red-500">{error}</span>}

        {confirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
            <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setConfirmOpen(false)} aria-hidden />
            <div className="relative w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
              <h2 className="text-base font-semibold tracking-tight text-ink">Confirm bank transfer</h2>
              <p className="mt-1 text-[12.5px] text-muted">
                Upload the bank receipt confirming funds were received. This marks the order paid and submits it to the supplier.
              </p>

              <div className="mt-4 rounded-xl border border-dashed border-line bg-[#faf9f5] p-4">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:border-ink">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  Browse…
                </label>
                {file ? (
                  <div className="mt-3 flex items-center gap-3">
                    {file.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={URL.createObjectURL(file)} alt="" className="size-12 rounded-lg border border-line object-cover" />
                    ) : (
                      <span className="text-2xl">📄</span>
                    )}
                    <div className="min-w-0 text-[12.5px]">
                      <div className="truncate font-medium text-ink">{file.name}</div>
                      <div className="text-muted">{fmtSize(file.size)}</div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-muted">No file selected — image or PDF, ≤ 10 MB.</p>
                )}
              </div>

              {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy} className="py-2">
                  Cancel
                </Button>
                <Button variant="primary" onClick={submitReceipt} busy={busy} disabled={!file} className="py-2">
                  {busy ? "Confirming…" : "Confirm payment"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- Cancelled: terminal ----
  if (status === "cancelled") return <span className="text-xs text-muted">Cancelled</span>;

  // ---- Fulfilment advance ----
  const next = NEXT_ACTION[status];
  if (!next) return <span className="text-xs font-medium text-emerald-600">Complete ✓</span>;

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() => post(`/api/orders/${orderId}/advance`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: next.action }) })}
        disabled={busy}
        className={cx(BTN, busy ? "opacity-50" : "hover:border-brass hover:text-brass")}
      >
        {busy ? "Syncing…" : next.label + " →"}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}
