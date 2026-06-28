"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { QuoteDetails, SavedAddress } from "@/lib/types";
import { QuoteDetailsFields, type QuoteDetailsErrors, validateQuoteDetails } from "./QuoteDetailsFields";
import { addressToDetails, AddressBookPicker } from "./AddressBookPicker";
import { Button } from "./ui";

type Mode = "edit" | "change";

/** Edit a quote's header details in a slide-over. Accessory quotes get two entry points:
 *  - "Change address" → pick a saved address; selecting one applies it immediately (no Save step).
 *  - "Edit"           → edit the current quote's fields directly, then Save.
 *  Product quotes get a single "Edit details" form. */
export function QuoteDetailsDrawer({
  quoteId,
  initial,
  accessory = false,
}: {
  quoteId: number;
  initial: QuoteDetails;
  accessory?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [d, setD] = useState<QuoteDetails>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<QuoteDetailsErrors>({});

  const openMode = (m: Mode) => {
    setD(initial);
    setErrors({});
    setError(null);
    setMode(m);
  };

  const update = (next: QuoteDetails) => {
    setD(next);
    if (Object.keys(errors).length) setErrors(validateQuoteDetails(next));
  };

  // PATCH the quote with the given details; closes + refreshes on success.
  const persist = async (details: QuoteDetails) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/quotes/${quoteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save");
      }
      setMode(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Change mode: picking a saved address applies it to the quote immediately (no Save step).
  const pickAndSave = (a: SavedAddress) => {
    const next = { ...d, ...addressToDetails(a) };
    if (Object.keys(validateQuoteDetails(next)).length) {
      setError("This address is missing required fields — edit it to add them first.");
      return;
    }
    persist(next);
  };

  // Edit mode: validate the form, then save.
  const save = () => {
    const errs = validateQuoteDetails(d);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setError("Please complete the required fields.");
      return;
    }
    setErrors({});
    persist(d);
  };

  return (
    <>
      {accessory ? (
        <div className="flex items-center gap-3">
          <button
            onClick={() => openMode("change")}
            className="text-[12.5px] font-medium text-brass transition-colors hover:underline"
          >
            Change address
          </button>
          <span className="text-line">|</span>
          <button
            onClick={() => openMode("edit")}
            className="text-[12.5px] font-medium text-brass transition-colors hover:underline"
          >
            Edit
          </button>
        </div>
      ) : (
        <button
          onClick={() => openMode("edit")}
          className="text-[12.5px] font-medium text-brass transition-colors hover:underline"
        >
          Edit details
        </button>
      )}

      {mode && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => !busy && setMode(null)} aria-hidden />
          <div className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                {mode === "change" ? "Change address" : "Edit quote details"}
              </h2>
              <button
                onClick={() => !busy && setMode(null)}
                aria-label="Close"
                className="rounded-lg p-1 text-muted transition-colors hover:bg-[#f1efe9] hover:text-ink"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {mode === "change" ? (
                <>
                  {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
                  <AddressBookPicker selectedId={null} onPick={pickAndSave} />
                </>
              ) : (
                <QuoteDetailsFields value={d} onChange={update} errors={errors} showRequired />
              )}
            </div>
            {mode === "edit" && (
              <div className="border-t border-line px-6 py-4">
                {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
                <Button variant="primary" onClick={save} busy={busy} className="w-full py-2.5">
                  Save changes
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
