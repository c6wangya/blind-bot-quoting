"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BankInfo } from "@/lib/db";
import { useToast } from "./Toast";
import { Button, Card, Input, Textarea } from "./ui";

const FIELDS: { key: keyof BankInfo; label: string; area?: boolean }[] = [
  { key: "bankName", label: "Bank name" },
  { key: "accountName", label: "Account holder" },
  { key: "accountNumber", label: "Account number" },
  { key: "routingNumber", label: "Routing / ABA" },
  { key: "swift", label: "SWIFT / BIC" },
  { key: "instructions", label: "Notes / instructions for the retailer", area: true },
];

export function BankSettingsForm({ initial }: { initial: BankInfo }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Save failed");
      toast("Bank details saved");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl space-y-3 p-5">
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{f.label}</span>
          {f.area ? (
            <Textarea value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} rows={3} />
          ) : (
            <Input value={form[f.key]} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} />
          )}
        </label>
      ))}
      <div className="pt-1">
        <Button variant="primary" busy={busy} onClick={save} className="py-2">
          Save bank details
        </Button>
      </div>
    </Card>
  );
}
