"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { VariationType } from "@/lib/db";
import { availableTypes, buildBlockedFromGroups, buildItemNames, disabledFor } from "@/lib/variation-logic";
import { VariationPicker } from "./AccessoryActions";
import { Button, Card, cx } from "./ui";

/** Searchable customer picker for the "Customer kits" tab — filters by company + email. */
export function RetailerKitPicker({ retailers }: { retailers: { id: string; email: string; company: string | null }[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? retailers.filter((r) => `${r.company ?? ""} ${r.email}`.toLowerCase().includes(needle))
    : retailers;
  return (
    <div className="space-y-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search customers by company or email…"
        className="w-full max-w-md rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink"
      />
      <div className="space-y-2">
        {shown.map((r) => (
          <Link key={r.id} href={`/motors?tab=defaults&retailer=${r.id}`} className="block">
            <Card className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-[#faf9f5]">
              <div>
                <div className="text-[14px] font-semibold text-ink">{r.company ?? r.email}</div>
                {r.company && <div className="text-[12px] text-muted">{r.email}</div>}
              </div>
              <span className="text-brass">→</span>
            </Card>
          </Link>
        ))}
        {shown.length === 0 && <div className="text-[12.5px] text-muted">{retailers.length === 0 ? "No customers yet." : "No matching customers."}</div>}
      </div>
    </div>
  );
}

export type KitProduct = {
  id: string;
  name: string;
  sku: string;
  categoryName: string;
  /** variation item ids assigned to this model (only these can be defaulted). */
  assigned: string[];
};

async function call(body: unknown) {
  const r = await fetch("/api/motors/variations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Save failed");
}

/**
 * Admin tool: pre-configure ONE customer's default variation items per model (a "kit"). When that
 * customer opens a model on the accessory page, these items auto-select for them — handy for
 * low-literacy customers who don't know which parts go together. Exclusion groups are honoured:
 * conflicting items grey out exactly like the customer's own picker. Saved per model.
 */
export function RetailerDefaultsAdmin({
  retailerId,
  retailerLabel,
  products,
  variations,
  exclusionGroups,
  globalDefaults,
  retailerDefaults,
}: {
  retailerId: string;
  retailerLabel: string;
  products: KitProduct[];
  variations: VariationType[];
  /** model_id → exclusion groups (each a list of item ids; at most one per group). */
  exclusionGroups: Record<string, string[][]>;
  /** model_id → store-wide default item ids (shown as the fallback baseline). */
  globalDefaults: Record<string, string[]>;
  /** model_id → this customer's current kit (item ids). */
  retailerDefaults: Record<string, string[]>;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? products.filter((p) => `${p.name} ${p.sku} ${p.categoryName}`.toLowerCase().includes(needle))
    : products;

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-muted">
        Pre-pick the parts <b className="text-ink">{retailerLabel}</b> should get by default. When they open a product
        on the accessory page, these auto-select. Leave a product empty to fall back to the store default.
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search products…"
        className="w-full max-w-sm rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-ink"
      />
      <div className="divide-y divide-line rounded-xl border border-line">
        {shown.length === 0 && <div className="px-4 py-6 text-center text-[12.5px] text-muted">No matching products.</div>}
        {shown.map((p) => (
          <KitRow
            key={p.id}
            retailerId={retailerId}
            product={p}
            variations={variations}
            exclusionGroups={exclusionGroups}
            globalDefaults={globalDefaults[p.id] ?? []}
            initial={retailerDefaults[p.id] ?? []}
          />
        ))}
      </div>
    </div>
  );
}

function KitRow({
  retailerId,
  product,
  variations,
  exclusionGroups,
  globalDefaults,
  initial,
}: {
  retailerId: string;
  product: KitProduct;
  variations: VariationType[];
  exclusionGroups: Record<string, string[][]>;
  globalDefaults: string[];
  initial: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);

  const avail = useMemo(() => availableTypes(variations, product.assigned), [variations, product.assigned]);
  const blocked = useMemo(() => buildBlockedFromGroups(exclusionGroups[product.id] ?? []), [exclusionGroups, product.id]);
  const itemName = useMemo(() => buildItemNames(avail), [avail]);

  // pick: typeId → chosen item ids. Seed from the customer's saved kit, conflict-aware.
  const seed = useMemo<Record<string, string[]>>(() => {
    const p: Record<string, string[]> = {};
    const chosen = new Set<string>();
    const ok = (id: string) => {
      const c = blocked.get(id);
      if (!c) return true;
      for (const x of chosen) if (c.has(x)) return false;
      return true;
    };
    for (const t of avail) {
      const ids: string[] = [];
      for (const i of t.items)
        if (initial.includes(i.id) && ok(i.id)) { ids.push(i.id); chosen.add(i.id); }
      p[t.id] = ids;
    }
    return p;
  }, [avail, blocked, initial]);

  const [pick, setPick] = useState<Record<string, string[]>>(seed);

  const selectedIds = avail.flatMap((t) => pick[t.id] ?? []);
  const selectedSet = new Set(selectedIds);

  const choose = (typeId: string, itemId: string) =>
    setPick((prev) => {
      const cur = prev[typeId] ?? [];
      if (cur.includes(itemId)) return { ...prev, [typeId]: cur.filter((x) => x !== itemId) };
      const conflicts = blocked.get(itemId);
      const next: Record<string, string[]> = {};
      for (const [tid, ids] of Object.entries(prev)) next[tid] = conflicts ? ids.filter((id) => !conflicts.has(id)) : ids;
      next[typeId] = [...(next[typeId] ?? []), itemId];
      return next;
    });

  const initialSet = new Set(initial);
  const dirty = selectedIds.length !== initialSet.size || selectedIds.some((id) => !initialSet.has(id));

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await call({ entity: "retailer-default", retailerId, modelId: product.id, itemIds: selectedIds });
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const summary = selectedIds.length
    ? selectedIds.map((id) => itemName[id] ?? id).join(", ")
    : globalDefaults.length
      ? `Store default: ${globalDefaults.map((id) => itemName[id] ?? id).join(", ")}`
      : "No default";

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen((o) => !o)} className="w-4 text-muted hover:text-ink" aria-label="Toggle">{open ? "▾" : "▸"}</button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-ink">{product.name}</div>
          <div className="truncate text-[11px] text-muted">{product.categoryName} · {product.sku}</div>
        </div>
        <span className={cx("max-w-[45%] truncate text-[11px]", selectedIds.length ? "text-ink-soft" : "text-muted")} title={summary}>
          {summary}
        </span>
      </div>
      {open && (
        <div className="mt-2.5 space-y-4 pl-7">
          {avail.length === 0 && <span className="text-[11px] text-muted">No variation items assigned to this product yet.</span>}
          {avail.map((t) => {
            const d = disabledFor(t, selectedSet, blocked, itemName);
            return (
              <div key={t.id}>
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{t.name}</span>
                <VariationPicker
                  type={t}
                  values={pick[t.id] ?? []}
                  onToggle={(v) => choose(t.id, v)}
                  onZoom={setZoom}
                  disabled={d.ids}
                  disabledReason={d.reason}
                />
              </div>
            );
          })}
          {avail.length > 0 && (
            <div className="flex items-center gap-3">
              <Button variant="primary" busy={busy} disabled={!dirty} className="py-1 text-[12px]" onClick={save}>Save kit</Button>
              {globalDefaults.length > 0 && (
                <span className="text-[11px] text-muted">
                  Store default: {globalDefaults.map((id) => itemName[id] ?? id).join(", ")}
                </span>
              )}
              {err && <span className="text-[11px] text-red-500">{err}</span>}
            </div>
          )}
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-8" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-h-full max-w-full rounded-xl bg-[#0e0e10] object-contain p-2" />
        </div>
      )}
    </div>
  );
}
