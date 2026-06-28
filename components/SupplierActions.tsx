"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/types";
import { useToast } from "./Toast";
import { Button, cx } from "./ui";

// Product orders run the full 6-step pipeline.
const NEXT_ACTION_PRODUCT: Partial<Record<OrderStatus, { action: string; label: string }>> = {
  submitted: { action: "acknowledge", label: "Acknowledge + issue order №" },
  acknowledged: { action: "start_production", label: "Start production" },
  in_production: { action: "ship", label: "Ship + issue tracking №" },
  shipped: { action: "in_transit", label: "Mark in transit" },
  in_transit: { action: "deliver", label: "Mark delivered" },
};

// Accessory-only orders auto-acknowledge on payment, so the supplier's only manual step is shipping.
const NEXT_ACTION_ACCESSORY: Partial<Record<OrderStatus, { action: string; label: string }>> = {
  submitted: { action: "acknowledge", label: "Acknowledge + issue order №" },
  acknowledged: { action: "ship", label: "Ship + issue tracking №" },
};

const BTN = "rounded-xl border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink shadow-sm transition-all";

function fmtSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Pull UPS "1Z" tracking numbers out of arbitrary pasted text. A 1Z number is fixed-length:
 * `1Z` + 6-char shipper + 2-digit service + 8-digit package id + 1 check digit = 18 chars total.
 * We tolerate spaces/tabs between groups (UPS prints them as `1Z 999 AA1 01 2345 6784`), uppercase,
 * and dedupe so pasting a whole shipment email yields a clean list.
 */
function extractUpsTracking(text: string): string[] {
  const re = /1Z(?:[ \t]*[0-9A-Z]){16}/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const n = m[0].replace(/[ \t]+/g, "").toUpperCase();
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export default function SupplierAdvanceButton({
  orderId,
  status,
  accessoryOnly = false,
  paymentMethod,
  paymentStatus,
}: {
  orderId: number;
  status: OrderStatus;
  accessoryOnly?: boolean;
  paymentMethod?: PaymentMethod | null;
  paymentStatus?: PaymentStatus;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // Ship modal: one carrier + one-or-more tracking numbers. UPS is the default carrier and gets a
  // paste box that auto-detects 1Z numbers.
  const [shipOpen, setShipOpen] = useState(false);
  const [carrier, setCarrier] = useState("UPS");
  const [tracks, setTracks] = useState<string[]>([""]);
  const [pasteText, setPasteText] = useState("");

  const post = async (url: string, init?: RequestInit, successMsg?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, { method: "POST", ...init });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Request failed");
      }
      if (successMsg) toast(successMsg);
      router.refresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Close an unpaid order (e.g. the customer never paid): release reserved stock + reopen quote.
  const closeControl = confirmClose ? (
    <span className="flex items-center gap-2 text-[11px]">
      <span className="text-muted">Close &amp; release stock?</span>
      <button onClick={() => post(`/api/orders/${orderId}/cancel`, undefined, "Order closed — stock released")} disabled={busy} className="font-semibold text-red-600 hover:underline">
        {busy ? "…" : "Yes, close"}
      </button>
      <button onClick={() => setConfirmClose(false)} disabled={busy} className="text-muted hover:underline">
        No
      </button>
    </span>
  ) : (
    <button onClick={() => setConfirmClose(true)} disabled={busy} className="text-[11px] font-medium text-muted hover:text-red-500">
      Close order
    </button>
  );

  const setTrack = (i: number, v: string) => setTracks((t) => t.map((x, j) => (j === i ? v : x)));
  const addTrack = () => setTracks((t) => [...t, ""]);
  const removeTrack = (i: number) => setTracks((t) => (t.length > 1 ? t.filter((_, j) => j !== i) : t));

  // Paste box (UPS): detect 1Z numbers in the pasted blob and fill the rows with them.
  const applyPaste = (text: string) => {
    setPasteText(text);
    const found = extractUpsTracking(text);
    if (found.length) setTracks(found);
  };
  const openShip = () => {
    setError(null);
    setTracks([""]);
    setPasteText("");
    setShipOpen(true);
  };

  const submitShip = async () => {
    const nums = tracks.map((t) => t.trim()).filter(Boolean);
    if (nums.length === 0) {
      setError("Enter at least one tracking number.");
      return;
    }
    const ok = await post(
      `/api/orders/${orderId}/advance`,
      { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ship", carrier, trackingNos: nums }) },
      "Order shipped — tracking issued"
    );
    if (ok) {
      setShipOpen(false);
      setTracks([""]);
      setPasteText("");
    }
  };

  const submitReceipt = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const ok = await post(`/api/orders/${orderId}/confirm-payment`, { body: fd }, "Payment confirmed — order submitted");
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
        {closeControl}
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
  const next = (accessoryOnly ? NEXT_ACTION_ACCESSORY : NEXT_ACTION_PRODUCT)[status];
  if (!next) return <span className="text-xs font-medium text-emerald-600">Complete ✓</span>;

  // Accessory orders collect tracking numbers via a modal on ship; everything else advances directly.
  const isShip = next.action === "ship" && accessoryOnly;
  const filledTracks = tracks.filter((t) => t.trim()).length;
  const isUps = carrier.trim().toUpperCase() === "UPS";
  const detected = isUps && pasteText.trim() ? extractUpsTracking(pasteText).length : 0;

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() =>
          isShip
            ? openShip()
            : post(`/api/orders/${orderId}/advance`, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: next.action }) }, "Order updated")
        }
        disabled={busy}
        className={cx(BTN, busy ? "opacity-50" : "hover:border-brass hover:text-brass")}
      >
        {busy ? "Syncing…" : next.label + " →"}
      </button>
      {error && !shipOpen && <span className="text-[11px] text-red-500">{error}</span>}

      {shipOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 text-left">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setShipOpen(false)} aria-hidden />
          <div className="relative w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="text-base font-semibold tracking-tight text-ink">Ship order · issue tracking</h2>
            <p className="mt-1 text-[12.5px] text-muted">
              Mark this order shipped and record its tracking number(s). Add one row per parcel — all are pushed
              to the retailer.
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Carrier</label>
                <input
                  list="ship-carriers"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="e.g. SF Express Intl"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
                />
                <datalist id="ship-carriers">
                  {["SF Express Intl", "DHL Express", "FedEx", "UPS", "USPS", "China Post", "Cainiao"].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Tracking number{tracks.length > 1 ? "s" : ""}
                </label>
                {isUps && (
                  <div className="mb-2.5">
                    <textarea
                      value={pasteText}
                      onChange={(e) => applyPaste(e.target.value)}
                      rows={3}
                      placeholder="Paste anything containing UPS 1Z numbers — they're detected automatically (e.g. 1Z999AA10123456784)"
                      className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-ink"
                    />
                    <p className="mt-1 text-[11px] text-muted">
                      {pasteText.trim()
                        ? detected > 0
                          ? `Detected ${detected} UPS number${detected === 1 ? "" : "s"} → filled below (edit or remove as needed).`
                          : "No 1Z… numbers found in the pasted text yet."
                        : "UPS numbers start with 1Z and are 18 characters."}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  {tracks.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-muted">{i + 1}.</span>
                      <input
                        autoFocus={i === tracks.length - 1}
                        value={t}
                        onChange={(e) => setTrack(i, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (t.trim() && i === tracks.length - 1) addTrack();
                          }
                        }}
                        placeholder="Scan or paste tracking number"
                        className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-ink"
                      />
                      <button
                        type="button"
                        onClick={() => removeTrack(i)}
                        disabled={tracks.length === 1}
                        aria-label="Remove tracking number"
                        className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-[#faf3f3] hover:text-red-500 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                      >
                        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addTrack}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-brass hover:underline"
                >
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Add another tracking number
                </button>
              </div>
            </div>

            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            <div className="mt-5 flex items-center justify-between">
              <span className="text-[11.5px] text-muted">
                {filledTracks} number{filledTracks === 1 ? "" : "s"} · {carrier.trim() || "UPS"}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setShipOpen(false)} disabled={busy} className="py-2">
                  Cancel
                </Button>
                <Button variant="primary" onClick={submitShip} busy={busy} disabled={filledTracks === 0} className="py-2">
                  {busy ? "Shipping…" : "Mark shipped →"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
