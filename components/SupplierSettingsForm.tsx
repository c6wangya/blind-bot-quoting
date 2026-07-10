"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SupplierInfo } from "@/lib/db";
import { useToast } from "./Toast";
import { Button, Card, Input, Textarea } from "./ui";

const EMPTY: SupplierInfo = {
  name: "",
  addressLines: [],
  tel: "",
  fax: "",
  website: "",
  bankName: "",
  swift: "",
  beneficiary: "",
  accountNumber: "",
  bankAddress: "",
};

/**
 * Per-brand supplier profile editor. Pick a brand, edit its company header + bank details; each
 * brand's own purchase orders print this block. One form, switched by the brand selector.
 */
export function SupplierSettingsForm({
  brands,
  suppliers,
}: {
  brands: { id: string; name: string }[];
  suppliers: Record<string, SupplierInfo>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  // Draft edits per brand, so switching brands keeps unsaved changes in view.
  const [drafts, setDrafts] = useState<Record<string, SupplierInfo>>(suppliers);
  const [busy, setBusy] = useState(false);

  const cur = useMemo(() => drafts[brandId] ?? suppliers[brandId] ?? EMPTY, [drafts, suppliers, brandId]);
  const set = (patch: Partial<SupplierInfo>) => setDrafts((d) => ({ ...d, [brandId]: { ...cur, ...patch } }));

  const save = async () => {
    if (!brandId) return;
    setBusy(true);
    try {
      const info: SupplierInfo = {
        ...cur,
        name: cur.name.trim(),
        addressLines: cur.addressLines,
        tel: cur.tel.trim(),
        fax: cur.fax.trim(),
        website: cur.website.trim(),
        bankName: cur.bankName.trim(),
        swift: cur.swift.trim(),
        beneficiary: cur.beneficiary.trim(),
        accountNumber: cur.accountNumber.trim(),
        bankAddress: cur.bankAddress.trim(),
      };
      const r = await fetch("/api/settings/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, ...info }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Save failed");
      toast("Supplier info saved");
      router.refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (brands.length === 0) {
    return <Card className="max-w-2xl p-5 text-sm text-muted">No brands yet — add a brand in the catalog first.</Card>;
  }

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder = "") => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );

  return (
    <Card className="max-w-2xl space-y-4 p-5">
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Brand / supplier</span>
        <select
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field("Company name", cur.name, (v) => set({ name: v }), "Guangdong A-OK Technology…")}
        {field("Website", cur.website, (v) => set({ website: v }), "www.aoksz.com")}
        {field("Tel", cur.tel, (v) => set({ tel: v }), "86-752-5718330")}
        {field("Fax", cur.fax, (v) => set({ fax: v }), "86-752-5718329")}
      </div>
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Address — one line per row</span>
        <Textarea
          value={cur.addressLines.join("\n")}
          onChange={(e) => set({ addressLines: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })}
          rows={3}
          placeholder={"Hexing Road South side, Sanhe Economic Development Zone\nHuiyang, Huizhou, Guangdong, CN"}
        />
      </label>

      <div className="border-t border-line pt-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Bank details</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field("Beneficiary's bank name", cur.bankName, (v) => set({ bankName: v }), "BANK OF CHINA, HUIYANG SUB-BRANCH")}
          {field("Swift code", cur.swift, (v) => set({ swift: v }), "BKCHCNBJ47A")}
          {field("Beneficiary's name", cur.beneficiary, (v) => set({ beneficiary: v }), "Guangdong A-OK Technology…Co.,Ltd")}
          {field("A/C No.", cur.accountNumber, (v) => set({ accountNumber: v }), "6626 6925 3515")}
        </div>
        <div className="mt-3">
          {field("Bank / beneficiary address", cur.bankAddress, (v) => set({ bankAddress: v }), "Hexing Road South side, Huiyang, Huizhou, CN")}
        </div>
      </div>

      <div className="pt-1">
        <Button variant="primary" busy={busy} onClick={save} className="py-2">
          Save supplier info
        </Button>
      </div>
    </Card>
  );
}
