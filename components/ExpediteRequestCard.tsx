"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usd } from "@/lib/format";
import { useToast } from "./Toast";
import { cx, Spinner } from "./ui";
import type { ChatRole } from "@/lib/db";

/**
 * An expedite-pricing request rendered inline in the support chat (message kind='expedite_request').
 * The admin prices it right here (prefilled with the system reference fee); the retailer sees the
 * request status and, once set, the quoted fee.
 */
export function ExpediteRequestCard({
  messageId,
  quoteId,
  quoteRef,
  body,
  refFee,
  quotedFee,
  role,
}: {
  messageId: string;
  quoteId: number | null;
  quoteRef: string | null;
  body: string;
  refFee: number | null;
  quotedFee: number | null;
  role: ChatRole;
}) {
  const router = useRouter();
  const toast = useToast();
  const [fee, setFee] = useState(quotedFee != null ? String(quotedFee) : refFee != null ? String(refFee) : "");
  const [savedFee, setSavedFee] = useState<number | null>(quotedFee);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = Number(fee);
    if (!Number.isFinite(n) || n < 0) {
      toast("Enter a valid fee (0 or more).", "error");
      return;
    }
    if (!quoteId) {
      toast("This quote no longer exists.", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/quotes/${quoteId}/expedite-quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee: n, messageId }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed");
      setSavedFee(Math.round(n * 100) / 100);
      toast("Expedite fee sent to the customer.", "success");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[340px] rounded-2xl border border-brass/40 bg-brass-soft/40 p-3.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">
        <span aria-hidden>⚡</span> Expedited shipping request
      </div>
      {quoteRef && (
        quoteId ? (
          <Link href={`/quotes/${quoteId}`} className="mt-1 inline-block text-[12px] font-medium text-ink hover:text-brass">
            Re: {quoteRef} →
          </Link>
        ) : (
          <span className="mt-1 inline-block text-[12px] font-medium text-muted">Re: {quoteRef}</span>
        )
      )}
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">{body}</p>
      {refFee != null && (
        <p className="mt-1.5 text-[11.5px] text-muted">
          System reference: <span className="font-medium text-ink-soft tabular-nums">{usd(refFee)}</span>
        </p>
      )}

      {savedFee != null ? (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[12.5px] font-medium text-emerald-700">
          <span aria-hidden>✓</span> Quoted: <span className="tabular-nums">{usd(savedFee)}</span>
        </div>
      ) : role === "admin" ? (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-muted">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-line bg-surface py-1.5 pl-5 pr-2 text-[13px] tabular-nums text-ink outline-none focus:border-ink disabled:opacity-60"
            />
          </div>
          <button
            onClick={submit}
            disabled={busy}
            className={cx(
              "shrink-0 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity",
              busy ? "opacity-60" : "hover:opacity-90"
            )}
          >
            {busy ? <Spinner /> : "Send quote"}
          </button>
        </div>
      ) : (
        <div className="mt-2.5 text-[12px] text-muted">Awaiting our price — we&apos;ll send it shortly.</div>
      )}
    </div>
  );
}
