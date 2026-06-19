"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminCatalog, AdminCategory, AdminModel } from "@/lib/db";
import type { AccessoryBrand } from "@/lib/db";
import { Button, Card, cx } from "./ui";

async function call(method: string, body: unknown): Promise<{ how?: "soft" | "hard" }> {
  const r = await fetch("/api/motors/catalog", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

const INPUT = "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink";

async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch("/api/motors/catalog/image", { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Upload failed");
  return data.url as string;
}

/** Admin catalog tree: brands → categories → models, all editable (incl. image upload). */
export function CatalogAdmin({ catalog }: { catalog: AdminCatalog }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBrand, setNewBrand] = useState("");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-500">{error}</p>}

      {catalog.brands.map((brand) => (
        <BrandBlock key={brand.id} brand={brand} catalog={catalog} />
      ))}

      <Card className="flex items-end gap-2 px-5 py-4">
        <label className="flex-1">
          <span className="mb-1 block text-[10.5px] uppercase tracking-wide text-muted">New brand</span>
          <input value={newBrand} onChange={(e) => setNewBrand(e.target.value)} placeholder="Brand name" className={cx(INPUT, "w-full")} />
        </label>
        <Button
          variant="primary"
          busy={busy}
          className="py-1.5 text-[12px]"
          onClick={() => newBrand.trim() && run(async () => { await call("POST", { entity: "brand", name: newBrand, tagline: "" }); setNewBrand(""); })}
        >
          Add brand
        </Button>
      </Card>
    </div>
  );
}

function BrandBlock({ brand, catalog }: { brand: AccessoryBrand; catalog: AdminCatalog }) {
  const router = useRouter();
  const [name, setName] = useState(brand.name);
  const [tagline, setTagline] = useState(brand.tagline ?? "");
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);
  const cats = catalog.categories.filter((c) => c.brandId === brand.id);
  const dirty = name !== brand.name || tagline !== (brand.tagline ?? "");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); router.refresh(); } catch { /* ignore */ } finally { setBusy(false); }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#fafaf7] px-5 py-3">
        <input value={name} onChange={(e) => setName(e.target.value)} className={cx(INPUT, "w-40 font-semibold")} />
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="tagline" className={cx(INPUT, "flex-1")} />
        <Button variant="primary" busy={busy} disabled={!dirty} className="py-1.5 text-[12px]" onClick={() => run(() => call("PATCH", { entity: "brand", id: brand.id, name, tagline }))}>
          Save
        </Button>
        <button onClick={() => run(() => call("DELETE", { entity: "brand", id: brand.id }))} disabled={busy} className="text-[11px] font-medium text-muted hover:text-red-500">
          Delete brand
        </button>
      </div>

      <div className="space-y-3 px-5 py-4">
        {cats.map((cat) => (
          <CategoryBlock key={cat.id} category={cat} models={catalog.models.filter((m) => m.categoryId === cat.id)} />
        ))}
        <div className="flex items-end gap-2">
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" className={cx(INPUT, "w-56")} />
          <Button variant="secondary" busy={busy} className="py-1.5 text-[12px]" onClick={() => newCat.trim() && run(async () => { await call("POST", { entity: "category", brandId: brand.id, name: newCat }); setNewCat(""); })}>
            + Category
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CategoryBlock({ category, models }: { category: AdminCategory; models: AdminModel[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(category.name);
  const [blurb, setBlurb] = useState(category.blurb ?? "");
  const [orderable, setOrderable] = useState(category.orderable);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // add-model draft
  const [mSku, setMSku] = useState("");
  const [mName, setMName] = useState("");
  const [mPrice, setMPrice] = useState("");
  const [mDesc, setMDesc] = useState("");
  const dirty = name !== category.name || blurb !== (category.blurb ?? "") || orderable !== category.orderable;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-line">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen((o) => !o)} className="w-5 text-muted hover:text-ink" aria-label="Toggle">{open ? "▾" : "▸"}</button>
        <input value={name} onChange={(e) => setName(e.target.value)} className={cx(INPUT, "w-44 font-medium")} />
        <label className="flex items-center gap-1.5 text-[12px] text-ink-soft">
          <input type="checkbox" checked={orderable} onChange={(e) => setOrderable(e.target.checked)} /> orderable
        </label>
        <input value={blurb} onChange={(e) => setBlurb(e.target.value)} placeholder="blurb" className={cx(INPUT, "flex-1")} />
        <span className="text-[11px] text-muted">{models.length} models</span>
        <Button variant="primary" busy={busy} disabled={!dirty} className="py-1 text-[12px]" onClick={() => run(() => call("PATCH", { entity: "category", id: category.id, name, blurb, orderable }))}>
          Save
        </Button>
        <button onClick={() => run(() => call("DELETE", { entity: "category", id: category.id }))} disabled={busy} className="text-[11px] font-medium text-muted hover:text-red-500">
          Delete
        </button>
      </div>
      {err && <p className="px-3 pb-2 text-[11px] text-red-500">{err}</p>}

      {open && (
        <div className="border-t border-line/70 bg-[#fbfaf7] px-3 py-3">
          <ul className="space-y-1.5">
            {models.map((m) => (
              <ModelRow key={m.id} model={m} />
            ))}
          </ul>
          <div className="mt-3 space-y-2 rounded-lg border border-dashed border-line p-2.5">
            <div className="flex items-end gap-2">
              <input value={mSku} onChange={(e) => setMSku(e.target.value)} placeholder="SKU" className={cx(INPUT, "w-32")} />
              <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Model name" className={cx(INPUT, "flex-1")} />
              <div className="flex items-center rounded-lg border border-line px-2">
                <span className="text-xs text-muted">$</span>
                <input type="number" min={0} step="0.01" value={mPrice} onChange={(e) => setMPrice(e.target.value)} placeholder="—" className="w-16 bg-transparent px-1 py-1.5 text-sm text-ink outline-none" />
              </div>
              <Button variant="secondary" busy={busy} className="py-1 text-[12px]" onClick={() => mSku.trim() && mName.trim() && run(async () => { await call("POST", { entity: "model", categoryId: category.id, sku: mSku, name: mName, price: mPrice === "" ? null : Number(mPrice), description: mDesc }); setMSku(""); setMName(""); setMPrice(""); setMDesc(""); })}>
                + Model
              </Button>
            </div>
            <textarea value={mDesc} onChange={(e) => setMDesc(e.target.value)} rows={2} placeholder="Description (e.g. 0.3 N·m, 1 inch tube motor with built-in battery)" className={cx(INPUT, "w-full resize-none")} />
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRow({ model }: { model: AdminModel }) {
  const router = useRouter();
  const [name, setName] = useState(model.name);
  const [sku, setSku] = useState(model.sku);
  const [price, setPrice] = useState(model.price == null ? "" : String(model.price));
  const [active, setActive] = useState(model.active);
  const [details, setDetails] = useState(false);
  const [description, setDescription] = useState(model.description ?? "");
  const [image, setImage] = useState(model.imageUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty =
    name !== model.name || sku !== model.sku || active !== model.active ||
    (price === "" ? model.price != null : Number(price) !== model.price) ||
    description !== (model.description ?? "") || image !== (model.imageUrl ?? "");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <li className={cx("rounded-lg border border-line bg-surface px-2.5 py-2", !active && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className={cx(INPUT, "min-w-[160px] flex-1 font-medium")} />
        <input value={sku} onChange={(e) => setSku(e.target.value)} className={cx(INPUT, "w-36 font-mono text-[12px]")} />
        <div className="flex items-center rounded-lg border border-line px-2">
          <span className="text-xs text-muted">$</span>
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" className="w-16 bg-transparent px-1 py-1.5 text-sm text-ink outline-none" />
        </div>
        <label className="flex items-center gap-1 text-[11px] text-ink-soft">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> active
        </label>
        <button onClick={() => setDetails((d) => !d)} className="text-[11px] text-muted hover:text-ink">{details ? "less" : "details"}</button>
        <Button variant="primary" busy={busy} disabled={!dirty} className="py-1 text-[12px]" onClick={() => run(() => call("PATCH", { entity: "model", id: model.id, name, sku, price: price === "" ? null : Number(price), active, description, image }))}>
          Save
        </Button>
        <button
          onClick={() => run(async () => { const r = await call("DELETE", { entity: "model", id: model.id }); if (r.how === "soft") setErr("Referenced — deactivated instead of deleted."); })}
          disabled={busy}
          className="text-[11px] font-medium text-muted hover:text-red-500"
        >
          Delete
        </button>
      </div>
      {details && (
        <div className="mt-2 space-y-2">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Description" className={cx(INPUT, "w-full resize-none")} />
          <div className="flex items-center gap-2">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-[10px] text-muted">no img</div>
            )}
            <input value={image} onChange={(e) => setImage(e.target.value)} placeholder="Image URL" className={cx(INPUT, "flex-1")} />
            <label className={cx("cursor-pointer rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-soft hover:border-ink", busy && "pointer-events-none opacity-50")}>
              {busy ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) run(async () => setImage(await uploadImage(file)));
                }}
              />
            </label>
            {image && (
              <button onClick={() => setImage("")} disabled={busy} className="text-[11px] font-medium text-muted hover:text-red-500">Clear</button>
            )}
          </div>
          <p className="text-[10.5px] text-muted">Upload sets the URL above; click <span className="font-medium">Save</span> to persist. PNG/JPEG/WebP ≤ 5 MB.</p>
        </div>
      )}
      {err && <p className="mt-1 text-[11px] text-red-500">{err}</p>}
    </li>
  );
}
