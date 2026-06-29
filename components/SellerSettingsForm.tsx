"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SellerInfo } from "@/lib/db";
import { useToast } from "./Toast";
import { Button, Card, Input, Textarea } from "./ui";

/**
 * Edit the "from"/ship-from block printed top-left on invoices & purchase orders. Address is one
 * line per row; blank fields fall back to the env/brand defaults. Saved to app_settings.
 */
export function SellerSettingsForm({ initial }: { initial: SellerInfo }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.addressLines.join("\n"));
  const [taxId, setTaxId] = useState(initial.taxId);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const info: SellerInfo = {
        name: name.trim(),
        addressLines: address.split("\n").map((l) => l.trim()).filter(Boolean),
        taxId: taxId.trim(),
      };
      const r = await fetch("/api/settings/seller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Save failed");
      toast("Company info saved");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="max-w-xl space-y-3 p-5">
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Company name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Loom & Shade" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Address — one line per row</span>
        <Textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={4}
          placeholder={"123 Example Street\nSuite 000\nCity, ST 00000\nU.S.A"}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Tax ID</span>
        <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="00-0000000" />
      </label>
      <div className="pt-1">
        <Button variant="primary" busy={busy} onClick={save} className="py-2">
          Save company info
        </Button>
      </div>
    </Card>
  );
}
