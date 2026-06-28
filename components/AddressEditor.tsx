"use client";

import { useState } from "react";
import type { QuoteDetails, SavedAddress } from "@/lib/types";
import { QuoteDetailsFields, type QuoteDetailsErrors, validateQuoteDetails } from "./QuoteDetailsFields";
import { Button, cx } from "./ui";

const INPUT =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink";

/** Slide-over form for adding / editing one address-book entry. Reuses QuoteDetailsFields.
 *  `onSaved` fires after a successful create/update (caller decides whether to refresh/refetch). */
export function AddressEditor({
  address,
  onClose,
  onSaved,
}: {
  address: SavedAddress | null;
  onClose: () => void;
  onSaved: (saved: SavedAddress) => void;
}) {
  const [d, setD] = useState<QuoteDetails>(address ?? {});
  const [label, setLabel] = useState(address?.label ?? "");
  const [isDefault, setIsDefault] = useState(address?.isDefault ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<QuoteDetailsErrors>({});

  // Re-validate live once an error has shown, so messages clear as the user fixes fields.
  const update = (next: QuoteDetails) => {
    setD(next);
    if (Object.keys(errors).length) setErrors(validateQuoteDetails(next));
  };

  const save = async () => {
    const errs = validateQuoteDetails(d);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setError("Please complete the required fields.");
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      const url = address ? `/api/addresses/${address.id}` : "/api/addresses";
      const r = await fetch(url, {
        method: address ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...d, label, isDefault }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Could not save");
      onSaved(data.address as SavedAddress);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={() => !busy && onClose()} aria-hidden />
      <div className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-ink">
            {address ? "Edit address" : "New address"}
          </h2>
          <button
            onClick={() => !busy && onClose()}
            aria-label="Close"
            className="rounded-lg p-1 text-muted transition-colors hover:bg-[#f1efe9] hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <label className="mb-5 block">
            <span className="mb-1 block text-[12.5px] font-medium text-ink-soft">Label</span>
            <input
              className={INPUT}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Main warehouse, Job site A"
            />
          </label>
          <QuoteDetailsFields value={d} onChange={update} errors={errors} showRequired />
          <label className="mt-5 flex items-center gap-2 text-[13px] text-ink-soft">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Set as default address
          </label>
          {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" onClick={() => !busy && onClose()} className={cx(busy && "opacity-50")}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} busy={busy}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
