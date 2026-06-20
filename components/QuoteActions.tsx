"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, cx } from "./ui";

export function DeleteDraftButton({ quoteId }: { quoteId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const del = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/quotes/${quoteId}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not delete");
      }
      router.push("/quotes");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
        <p className="text-[13px] font-medium text-ink">Delete this draft and all its items?</p>
        <div className="mt-3 flex gap-2">
          <Button variant="danger" onClick={del} busy={busy} className="py-2">
            {busy ? "Deleting…" : "Delete draft"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy} className="py-2">
            Cancel
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="w-full rounded-xl border border-line py-2.5 text-sm font-medium text-muted transition-colors hover:border-red-300 hover:text-red-600"
    >
      Delete draft
    </button>
  );
}

type PayMethod = "bank_transfer" | "stripe" | "paypal";
const PAY_METHODS: { id: PayMethod; label: string; note: string; enabled: boolean }[] = [
  { id: "stripe", label: "Credit / debit card", note: "Secure checkout via Stripe", enabled: true },
  { id: "paypal", label: "PayPal", note: "Pay with your PayPal account", enabled: true },
  { id: "bank_transfer", label: "Bank transfer", note: "We confirm once received", enabled: true },
];

export function SubmitPreOrderButton({ quoteId, total }: { quoteId: number; total: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PayMethod>("stripe");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/quotes/${quoteId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Submission failed");
      if (data.redirect) {
        window.location.href = data.redirect; // gateway hand-off (Stripe/PayPal — later)
        return;
      }
      router.push(`/orders/${data.order.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <Button variant="primary" onClick={() => setOpen(true)} className="w-full py-3">
          Confirm &amp; pay →
        </Button>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brass/40 bg-brass-soft/60 p-4">
      <p className="text-[13px] font-medium text-ink">Pay {total} to place this pre-order</p>
      <div className="mt-3 space-y-2">
        {PAY_METHODS.map((m) => (
          <label
            key={m.id}
            className={cx(
              "flex items-center gap-2 rounded-xl border bg-surface px-3 py-2.5 text-sm",
              method === m.id && m.enabled ? "border-ink" : "border-line",
              m.enabled ? "cursor-pointer" : "cursor-not-allowed opacity-50"
            )}
          >
            <input type="radio" disabled={!m.enabled} checked={method === m.id} onChange={() => setMethod(m.id)} />
            <span className="flex-1 font-medium text-ink">{m.label}</span>
            <span className="text-[11px] text-muted">{m.note}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" onClick={submit} busy={busy} className="py-2">
          {busy ? "Placing…" : "Place pre-order"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy} className="py-2">
          Cancel
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function RemoveItemButton({ itemId, className }: { itemId: number; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/quote-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!r.ok) throw new Error();
      router.refresh();
    } catch {
      // surface failure by re-enabling the button so the user can retry
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={remove}
      disabled={busy}
      className={cx("text-xs font-medium text-muted transition-colors hover:text-red-500", className)}
      title="Remove line"
    >
      {busy ? "…" : "Remove"}
    </button>
  );
}
