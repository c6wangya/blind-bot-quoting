"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { QuoteDetails, SavedAddress } from "@/lib/types";
import { AddressEditor } from "./AddressEditor";
import { useToast } from "./Toast";

/** One-line summary of an address for the card. */
export function addressSummary(a: QuoteDetails): string {
  const cityLine = [a.shipCity, a.shipState, a.shipZip].filter(Boolean).join(", ");
  return [a.shipAddress1, a.shipAddress2, cityLine].filter(Boolean).join(" · ") || "No ship-to address";
}

/** Retailer-facing address book — saved quote-header presets (customer / ship-to / references).
 *  Add / edit / delete / set-default; the accessory checkout reuses these to backfill the form. */
export function AddressBook({ initial }: { initial: SavedAddress[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<SavedAddress | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const makeDefault = async (id: string) => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/addresses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setDefault: true }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not update");
      router.refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this saved address?")) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/addresses/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not delete");
      router.refresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {initial.map((a) => (
          <div key={a.id} className="flex flex-col rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-semibold text-ink">
                    {a.label || a.customerName || "Address"}
                  </span>
                  {a.isDefault && (
                    <span className="rounded-full bg-brass/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brass">
                      Default
                    </span>
                  )}
                </div>
                {a.customerName && a.label && (
                  <div className="mt-0.5 truncate text-[12.5px] text-ink-soft">{a.customerName}</div>
                )}
              </div>
            </div>
            <div className="mt-2 text-[12.5px] leading-relaxed text-muted">{addressSummary(a)}</div>
            {(a.customerPhone || a.customerEmail) && (
              <div className="mt-1 truncate text-[12px] text-muted">
                {[a.customerPhone, a.customerEmail].filter(Boolean).join(" · ")}
              </div>
            )}
            <div className="mt-3 flex items-center gap-3 border-t border-line/70 pt-3 text-[12.5px]">
              <button onClick={() => setEditing(a)} className="font-medium text-brass hover:underline">
                Edit
              </button>
              {!a.isDefault && (
                <button
                  onClick={() => makeDefault(a.id)}
                  disabled={busyId === a.id}
                  className="font-medium text-ink-soft hover:text-ink"
                >
                  Set default
                </button>
              )}
              <button
                onClick={() => remove(a.id)}
                disabled={busyId === a.id}
                className="ml-auto font-medium text-muted hover:text-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={() => setEditing("new")}
          className="flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-line text-muted transition-colors hover:border-ink hover:text-ink"
        >
          <span className="text-2xl leading-none text-brass">＋</span>
          <span className="text-[13px] font-medium">Add address</span>
        </button>
      </div>

      {editing && (
        <AddressEditor
          address={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
