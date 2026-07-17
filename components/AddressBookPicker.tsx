"use client";

import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import type { SavedAddress } from "@/lib/types";
import { addressSummary } from "./AddressBook";
import { AddressEditor } from "./AddressEditor";
import { cx } from "./ui";

/** Address-book quick-fill: loads the retailer's saved addresses and lists them as rows.
 *  Click a row to backfill the form (onPick); edit/view a saved address; or create a new one.
 *  Renders the "Create new address" affordance even when the book is empty. */
export function AddressBookPicker({
  selectedId,
  onPick,
  onLoaded,
}: {
  selectedId: string | null;
  onPick: (a: SavedAddress) => void;
  /** Called each time the list (re)loads — e.g. to auto-apply a default. */
  onLoaded?: (addresses: SavedAddress[]) => void;
}) {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [editing, setEditing] = useState<SavedAddress | "new" | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Re-fetch after a create/edit (used by event handlers, not the mount effect).
  const reload = async (): Promise<SavedAddress[]> => {
    try {
      const r = await fetch("/api/addresses");
      if (!r.ok) return addresses;
      const list: SavedAddress[] = (await r.json()).addresses ?? [];
      setAddresses(list);
      setLoaded(true);
      return list;
    } catch {
      return addresses;
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetch("/api/addresses");
        if (!r.ok) return;
        const list: SavedAddress[] = (await r.json()).addresses ?? [];
        if (!active) return;
        setAddresses(list);
        setLoaded(true);
        onLoaded?.(list);
      } catch {
        /* address book is optional — ignore */
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [busyStar, setBusyStar] = useState<string | null>(null);

  // Tapping the star makes an address the default — and (since the default fills the form) also
  // applies it to the form.
  const setDefault = async (a: SavedAddress) => {
    setBusyStar(a.id);
    try {
      if (!a.isDefault) {
        const r = await fetch(`/api/addresses/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setDefault: true }),
        });
        if (!r.ok) return;
        await reload();
      }
      onPick(a);
    } finally {
      setBusyStar(null);
    }
  };

  return (
    <div className="mb-6">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Saved addresses</div>

      {addresses.length > 0 && (
        <div className="space-y-2">
          {addresses.map((a) => (
            <div
              key={a.id}
              className={cx(
                "flex items-center rounded-xl border bg-surface transition-colors",
                selectedId === a.id ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink/40"
              )}
            >
              {/* Star → set as default (and fill the form, since the default is the picked one). */}
              <button
                type="button"
                onClick={() => setDefault(a)}
                disabled={busyStar === a.id}
                aria-label={a.isDefault ? "Default address" : "Set as default"}
                title={a.isDefault ? "Default address" : "Set as default"}
                className="shrink-0 py-2.5 pl-3 pr-1.5"
              >
                <Star
                  className={cx("size-[18px]", a.isDefault ? "fill-brass text-brass" : "text-muted hover:text-brass")}
                  strokeWidth={1.75}
                />
              </button>
              {/* Click the body → backfill the form with this address. */}
              <button
                type="button"
                onClick={() => onPick(a)}
                className="min-w-0 flex-1 px-2 py-2.5 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-semibold text-ink">
                    {a.label || a.customerName || "Address"}
                  </span>
                  {selectedId === a.id && <span className="text-[10px] font-semibold text-ink-soft">In use</span>}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-muted">{addressSummary(a)}</div>
              </button>
              {/* Edit / view details of the saved address. */}
              <button
                type="button"
                onClick={() => setEditing(a)}
                className="shrink-0 px-3 py-2.5 text-[12px] font-medium text-brass transition-colors hover:underline"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      )}

      {loaded && addresses.length === 0 && (
        <p className="mb-2 text-[12px] text-muted">No saved addresses yet.</p>
      )}

      <button
        type="button"
        onClick={() => setEditing("new")}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2.5 text-[13px] font-medium text-ink transition-colors hover:border-ink"
      >
        <span className="text-[15px] leading-none text-brass">＋</span> Create new address
      </button>

      {editing && (
        <AddressEditor
          address={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            const wasNew = editing === "new";
            setEditing(null);
            // Refresh the list, then apply a freshly-created address so it fills the form.
            reload().then(() => {
              if (wasNew) onPick(saved);
            });
          }}
        />
      )}
    </div>
  );
}

/** Shared "save these details to my address book" control (checkbox + optional label input). */
export function SaveToAddressBook({
  checked,
  onChecked,
  label,
  onLabel,
}: {
  checked: boolean;
  onChecked: (v: boolean) => void;
  label: string;
  onLabel: (v: string) => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-line bg-[#fbfaf6] px-3 py-2.5">
      <label className="flex items-center gap-2 text-[13px] text-ink-soft">
        <input type="checkbox" checked={checked} onChange={(e) => onChecked(e.target.checked)} />
        Save these details to my address book
      </label>
      {checked && (
        <input
          value={label}
          onChange={(e) => onLabel(e.target.value)}
          placeholder="Label (optional) — e.g. Main warehouse"
          className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-ink"
        />
      )}
    </div>
  );
}

/** Backfill QuoteDetails fields from a saved address (customer + ship-to + references). */
export function addressToDetails(a: SavedAddress) {
  return {
    customerName: a.customerName ?? null,
    customerPhone: a.customerPhone ?? null,
    customerEmail: a.customerEmail ?? null,
    shipAddress1: a.shipAddress1 ?? null,
    shipAddress2: a.shipAddress2 ?? null,
    shipCity: a.shipCity ?? null,
    shipState: a.shipState ?? null,
    shipZip: a.shipZip ?? null,
    po: a.po ?? null,
    sidemark: a.sidemark ?? null,
    projectName: a.projectName ?? null,
    contacts: a.contacts ?? [],
  };
}
