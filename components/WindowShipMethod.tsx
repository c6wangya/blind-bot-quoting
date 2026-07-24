"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Select } from "./ui";

/** Ship-method picker for a quote's window lines (ground / will call). Freight is applied at
 *  submit from the org's freight rules; this only stores the choice. */
export default function WindowShipMethod({
  quoteId,
  current,
  methods,
}: {
  quoteId: number;
  current: string;
  methods: { method: string; label: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted">Window shipping</span>
      <Select
        value={value}
        disabled={busy}
        onChange={async (e) => {
          const method = e.target.value;
          setValue(method);
          setBusy(true);
          try {
            await fetch("/api/window/ship-method", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ quoteId, method }),
            });
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
        className="w-40 text-xs"
      >
        {methods.map((m) => (
          <option key={m.method} value={m.method}>
            {m.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
