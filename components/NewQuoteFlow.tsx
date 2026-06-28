"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuoteDetails } from "@/lib/types";
import { clearPendingItem, pendingItemBody, readPendingItem, type PendingItem } from "@/lib/pending-item";
import { QuoteDetailsFields } from "./QuoteDetailsFields";
import { Button, Card } from "./ui";

type Draft = {
  id: number;
  ref: string;
  quoteName: string | null;
  customerName: string | null;
  sidemark: string | null;
  projectName: string | null;
  itemCount: number;
};

/**
 * Landing for "create a quote" — also the gate when a product is added with no active quote.
 * If a pending product is stashed AND drafts exist, offer "add to an existing draft" first;
 * otherwise just create a new quote (and replay the pending product into it).
 */
export function NewQuoteFlow() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingItem | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [d, setD] = useState<QuoteDetails>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pend = readPendingItem();
    let active = true;
    (async () => {
      let list: Draft[] = [];
      try {
        const r = await fetch("/api/quotes");
        if (r.ok) list = (await r.json()).drafts ?? [];
      } catch {
        /* ignore — show create form only */
      }
      if (active) {
        setPending(pend);
        setDrafts(list);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const addPendingTo = async (quoteId: number) => {
    if (!pending) return;
    const r = await fetch("/api/quote-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pendingItemBody(pending, quoteId)),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error ?? "Could not add the product");
    }
    clearPendingItem();
  };

  const createAndGo = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not create quote");
      const id = data.quote.id as number;
      if (pending) await addPendingTo(id);
      router.push(`/quotes/${id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const chooseExisting = async (quoteId: number) => {
    setBusy(true);
    setError(null);
    try {
      await addPendingTo(quoteId);
      router.push(`/quotes/${quoteId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const showChooser = !!pending && drafts.length > 0;

  return (
    <div className="mx-auto max-w-lg">
      {pending && (
        <Card className="mb-5 border-brass/40 bg-brass-soft/40 px-5 py-3 text-[13px] text-ink-soft">
          A configured product is ready —{" "}
          {showChooser ? "add it to an existing quote below, or create a new one." : "creating a quote will add it."}
        </Card>
      )}

      {showChooser && (
        <div className="mb-6">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
            Add to an existing draft
          </div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/70">
              {drafts.map((q) => (
                <li key={q.id}>
                  <button
                    disabled={busy}
                    onClick={() => chooseExisting(q.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#faf9f5] disabled:opacity-50"
                  >
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-ink">{q.quoteName || q.ref}</div>
                      <div className="truncate text-[11.5px] text-muted">
                        {[q.quoteName ? q.ref : null, q.customerName, q.sidemark, q.projectName].filter(Boolean).join(" · ") || "No details yet"}
                      </div>
                    </div>
                    <span className="shrink-0 text-[11.5px] text-muted">
                      {q.itemCount} item{q.itemCount === 1 ? "" : "s"} →
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> or create new <span className="h-px flex-1 bg-line" />
          </div>
        </div>
      )}

      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        {showChooser ? "New quote" : "Quote details"}
      </div>
      <Card className="px-6 py-5">
        <QuoteDetailsFields value={d} onChange={setD} />
      </Card>
      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      <div className="mt-5 flex justify-end">
        <Button variant="primary" onClick={createAndGo} busy={busy} className="px-6 py-2.5">
          {pending ? "Create quote & add product" : "Create quote"}
        </Button>
      </div>
      <p className="mt-2 text-right text-[11px] text-muted">All fields optional — you can edit them on the quote later.</p>
    </div>
  );
}
