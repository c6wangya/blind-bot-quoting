"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BuyerInfo } from "@/lib/db";
import { useToast } from "./Toast";
import { Button, Card, Input, Textarea } from "./ui";

/**
 * Edit the buyer block printed on every purchase order — our real purchasing company (e.g. Quarvia
 * Trade), distinct from the white-label brand shown to customers. Address is one line per row.
 */
export function BuyerSettingsForm({ initial }: { initial: BuyerInfo }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initial.name);
  const [attn, setAttn] = useState(initial.attn);
  const [address, setAddress] = useState(initial.addressLines.join("\n"));
  const [tel, setTel] = useState(initial.tel);
  const [email, setEmail] = useState(initial.email);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const info: BuyerInfo = {
        name: name.trim(),
        attn: attn.trim(),
        addressLines: address.split("\n").map((l) => l.trim()).filter(Boolean),
        tel: tel.trim(),
        email: email.trim(),
      };
      const r = await fetch("/api/settings/buyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Save failed");
      toast("Buyer info saved");
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
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Quarvia Trade" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Attn — contact person</span>
        <Input value={attn} onChange={(e) => setAttn(e.target.value)} placeholder="Alan / Bobby Wen" />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Address — one line per row</span>
        <Textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          rows={3}
          placeholder={"2470 Summerwood Ln\nGreenwood, IN, 46143\nU.S.A"}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Tel</span>
          <Input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="765 301 1262" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Email</span>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="orders@quarvia.com" />
        </label>
      </div>
      <div className="pt-1">
        <Button variant="primary" busy={busy} onClick={save} className="py-2">
          Save buyer info
        </Button>
      </div>
    </Card>
  );
}
