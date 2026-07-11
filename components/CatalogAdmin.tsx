"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminCatalog, AdminCategory, AdminModel, AccessoryBrand, AccessoryModelFile, ModelFileKind } from "@/lib/db";
import type { CompatVariation } from "@/lib/types";
import { useToast } from "./Toast";
import { Button, Card, cx } from "./ui";

type FilesMap = Record<string, AccessoryModelFile[]>;
type CompatMap = Record<string, CompatVariation[]>;

async function uploadModelFile(modelId: string, file: File, kind: ModelFileKind): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("modelId", modelId);
  fd.append("kind", kind);
  const r = await fetch("/api/motors/catalog/file", { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Upload failed");
}

type QuoteRef = { quoteId: number; ref: string | null };
async function call(
  method: string,
  body: unknown
): Promise<{ status?: "deleted" | "referenced"; quotes?: QuoteRef[] }> {
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

/** Admin catalog tree: brands → categories → models, all editable (incl. image + attachments). */
export function CatalogAdmin({
  catalog,
  files,
  compatVariations,
}: {
  catalog: AdminCatalog;
  files: FilesMap;
  compatVariations: CompatMap;
}) {
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
        <BrandBlock key={brand.id} brand={brand} catalog={catalog} files={files} compatVariations={compatVariations} />
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

function BrandBlock({ brand, catalog, files, compatVariations }: { brand: AccessoryBrand; catalog: AdminCatalog; files: FilesMap; compatVariations: CompatMap }) {
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
          <CategoryBlock key={cat.id} category={cat} catalog={catalog} models={catalog.models.filter((m) => m.categoryId === cat.id)} files={files} compatVariations={compatVariations} />
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

function CategoryBlock({ category, catalog, models, files, compatVariations }: { category: AdminCategory; catalog: AdminCatalog; models: AdminModel[]; files: FilesMap; compatVariations: CompatMap }) {
  const router = useRouter();
  const toast = useToast();
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
  const [mImage, setMImage] = useState("");
  const dirty = name !== category.name || blurb !== (category.blurb ?? "") || orderable !== category.orderable;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const syncVariation = () =>
    run(async () => {
      const r = await fetch("/api/motors/catalog/sync-variation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: category.id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Sync failed");
      toast(
        `Synced “${category.name}” → variation: ${data.created} new, ${data.updated} updated` +
          (data.removed ? `, ${data.removed} removed` : "")
      );
    });

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
        <button
          onClick={syncVariation}
          disabled={busy}
          title="Create/update a variation from this category's products (one option per product)"
          className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-ink-soft hover:border-brass hover:text-brass"
        >
          ⇅ Sync to variation
        </button>
        <button onClick={() => run(() => call("DELETE", { entity: "category", id: category.id }))} disabled={busy} className="text-[11px] font-medium text-muted hover:text-red-500">
          Delete
        </button>
      </div>
      {err && <p className="px-3 pb-2 text-[11px] text-red-500">{err}</p>}

      {open && (
        <div className="border-t border-line/70 bg-[#fbfaf7] px-3 py-3">
          <ul className="space-y-1.5">
            {models.map((m) => (
              <ModelRow key={`${m.id}:${m.active}`} model={m} catalog={catalog} files={files[m.id] ?? []} compatInitial={compatVariations[m.id] ?? []} />
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
              <Button variant="secondary" busy={busy} className="py-1 text-[12px]" onClick={() => mSku.trim() && mName.trim() && run(async () => { await call("POST", { entity: "model", categoryId: category.id, sku: mSku, name: mName, price: mPrice === "" ? null : Number(mPrice), description: mDesc, image: mImage }); setMSku(""); setMName(""); setMPrice(""); setMDesc(""); setMImage(""); })}>
                + Model
              </Button>
            </div>
            <textarea value={mDesc} onChange={(e) => setMDesc(e.target.value)} rows={2} placeholder="Description (e.g. 0.3 N·m, 1 inch tube motor with built-in battery)" className={cx(INPUT, "w-full resize-none")} />
            <div className="flex items-center gap-2">
              {mImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mImage} alt="" className="size-10 shrink-0 rounded-lg border border-line object-cover" />
              ) : (
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-line text-[9px] text-muted">img</div>
              )}
              <label className={cx("cursor-pointer rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-soft hover:border-ink", busy && "pointer-events-none opacity-50")}>
                {busy ? "…" : mImage ? "Change image" : "Upload image"}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(async () => setMImage(await uploadImage(f))); }} />
              </label>
              {mImage && <button onClick={() => setMImage("")} className="text-[11px] text-muted hover:text-red-500">Clear</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRow({ model, catalog, files, compatInitial }: { model: AdminModel; catalog: AdminCatalog; files: AccessoryModelFile[]; compatInitial: CompatVariation[] }) {
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
  const [confirming, setConfirming] = useState(false);
  const [confirmRefs, setConfirmRefs] = useState<QuoteRef[] | null>(null);
  const [fileKind, setFileKind] = useState<ModelFileKind>("spec");

  const deleteFile = (id: string) =>
    run(async () => {
      const r = await fetch("/api/motors/catalog/file", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Delete failed");
    });

  const dirty =
    name !== model.name || sku !== model.sku || active !== model.active ||
    (price === "" ? model.price != null : Number(price) !== model.price) ||
    description !== (model.description ?? "") || image !== (model.imageUrl ?? "");

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const cancelDelete = () => { setConfirming(false); setConfirmRefs(null); };

  // Delete click → check which quotes reference it (no delete yet), then show one confirm:
  // generic if unused, or the quote list if referenced. The confirm then force-deletes.
  const startDelete = () =>
    run(async () => {
      const r = await call("DELETE", { entity: "model", id: model.id, check: true });
      setConfirmRefs(r.quotes ?? []);
      setConfirming(true);
    });
  const confirmDelete = () => run(() => call("DELETE", { entity: "model", id: model.id, force: true }));

  return (
    <li className={cx("rounded-lg border bg-surface px-2.5 py-2", active ? "border-line" : "border-dashed border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className={cx(INPUT, "min-w-[160px] flex-1 font-medium", !active && "text-muted")} />
        <input value={sku} onChange={(e) => setSku(e.target.value)} className={cx(INPUT, "w-36 font-mono text-[12px]")} />
        <div className="flex items-center rounded-lg border border-line px-2">
          <span className="text-xs text-muted">$</span>
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="—" className="w-16 bg-transparent px-1 py-1.5 text-sm text-ink outline-none" />
        </div>
        {!active && (
          <span className="rounded-full bg-[#efece4] px-1.5 py-0.5 text-[10px] font-medium text-muted">Inactive</span>
        )}
        <label className="flex items-center gap-1 text-[11px] text-ink-soft">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> active
        </label>
        <button onClick={() => setDetails((d) => !d)} className="text-[11px] text-muted hover:text-ink">{details ? "less" : "details"}</button>
        <Button variant="primary" busy={busy} disabled={!dirty} className="py-1 text-[12px]" onClick={() => run(() => call("PATCH", { entity: "model", id: model.id, name, sku, price: price === "" ? null : Number(price), active, description, image }))}>
          Save
        </Button>
        <button
          onClick={startDelete}
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

          {/* Attachments — spec sheets, certifications, etc. */}
          <div className="mt-1 border-t border-line/70 pt-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Attachments — specs & certifications</div>
            {files.length > 0 && (
              <ul className="mb-2 space-y-1">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-[12px]">
                    <span className="rounded-full bg-[#efece4] px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted">{f.kind}</span>
                    <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">{f.name}</a>
                    <button onClick={() => deleteFile(f.id)} disabled={busy} className="text-[11px] font-medium text-muted hover:text-red-500">Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-2">
              <select value={fileKind} onChange={(e) => setFileKind(e.target.value as ModelFileKind)} className={cx(INPUT, "py-1 text-[12px]")}>
                <option value="spec">Spec sheet</option>
                <option value="certification">Certification</option>
                <option value="other">Other</option>
              </select>
              <label className={cx("cursor-pointer rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-soft hover:border-ink", busy && "pointer-events-none opacity-50")}>
                {busy ? "…" : "Upload file"}
                <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(() => uploadModelFile(model.id, f, fileKind)); }} />
              </label>
              <span className="text-[10.5px] text-muted">PDF / image / doc, ≤ 15 MB</span>
            </div>
          </div>

          {/* Compatible variation — named + imaged entries shown next to this accessory on the catalog */}
          <ModelCompatEditor modelId={model.id} catalog={catalog} variations={compatInitial} />
        </div>
      )}
      {confirming && (() => {
        const refs = confirmRefs ?? [];
        const referenced = refs.length > 0;
        return (
          <div
            className={cx(
              "mt-2 rounded-lg border px-3 py-2 text-[11.5px]",
              referenced ? "border-amber-300 bg-amber-50 text-amber-800" : "border-line bg-[#faf9f5] text-ink-soft"
            )}
          >
            {referenced ? (
              <p>
                In use on {refs.length} quote{refs.length === 1 ? "" : "s"}:{" "}
                <span className="font-medium">{refs.map((q) => q.ref || `#${q.quoteId}`).join(", ")}</span>.
                Those quotes keep their saved snapshot (name, price, image), so deleting will not change them.
              </p>
            ) : (
              <p>
                Delete <span className="font-medium">{model.name}</span> from the catalog? This cannot be undone.
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-3">
              <button onClick={confirmDelete} disabled={busy} className="font-semibold text-red-600 hover:underline">
                {referenced ? "Delete anyway" : "Delete"}
              </button>
              <button onClick={cancelDelete} disabled={busy} className="text-muted hover:underline">
                Cancel
              </button>
            </div>
          </div>
        );
      })()}
      {err && <p className="mt-1 text-[11px] text-red-500">{err}</p>}
    </li>
  );
}

/**
 * Per-model "Compatible variation" — a list of named + imaged entries, each of which checks any
 * number of OTHER catalog models (grouped by category on the retailer accessory page). All inline
 * in the model's details. "+ Add variation" creates an empty entry immediately (POST + refresh);
 * each entry's name/image/checked-items save together via PUT.
 */
function ModelCompatEditor({
  modelId,
  catalog,
  variations,
}: {
  modelId: string;
  catalog: AdminCatalog;
  variations: CompatVariation[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addVariation = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/motors/compat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, name: "" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Request failed");
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1 border-t border-line/70 pt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Compatible variation</span>
        <span className="text-[10.5px] text-muted/70">named entries · shown next to this part on the accessory page</span>
        <Button variant="secondary" busy={busy} className="ml-auto py-1 text-[11px]" onClick={addVariation}>
          + Add variation
        </Button>
      </div>

      {variations.length === 0 ? (
        <p className="text-[11px] text-muted/70">No compatible variations yet.</p>
      ) : (
        <div className="space-y-2">
          {variations.map((v) => (
            <CompatVariationRow key={v.id} variation={v} catalog={catalog} />
          ))}
        </div>
      )}
      {err && <p className="mt-1 text-[11px] text-red-500">{err}</p>}
    </div>
  );
}

/** One compatible-variation entry: title (name + image), a category→models checkbox tree, one Save. */
function CompatVariationRow({ variation, catalog }: { variation: CompatVariation; catalog: AdminCatalog }) {
  const router = useRouter();
  const [name, setName] = useState(variation.name);
  const [image, setImage] = useState(variation.imageUrl ?? "");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(variation.itemIds));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const initialItems = new Set(variation.itemIds);
  const dirty =
    name !== variation.name ||
    image !== (variation.imageUrl ?? "") ||
    selected.size !== initialItems.size ||
    [...selected].some((id) => !initialItems.has(id));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const save = () =>
    run(async () => {
      const r = await fetch("/api/motors/compat", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variationId: variation.id, name, imageUrl: image || null, itemIds: [...selected] }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Save failed");
    });

  const remove = () =>
    run(async () => {
      const r = await fetch("/api/motors/compat", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variationId: variation.id }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Delete failed");
    });

  // Only offer models from the SAME brand as the model being edited (an A-OK part shows A-OK parts).
  const ownBrand = catalog.categories.find(
    (c) => c.id === catalog.models.find((m) => m.id === variation.modelId)?.categoryId
  )?.brandId;
  const needle = q.trim().toLowerCase();
  const groups = catalog.categories
    .filter((c) => c.brandId === ownBrand)
    .map((c) => ({
      category: c,
      models: catalog.models.filter(
        (m) => m.categoryId === c.id && (!needle || `${m.name} ${m.sku}`.toLowerCase().includes(needle))
      ),
    }))
    .filter((g) => g.models.length > 0);
  const selCount = groups.reduce((n, g) => n + g.models.filter((m) => selected.has(m.id)).length, 0);

  return (
    <div className="rounded-lg border border-line bg-[#fbfaf7] p-2.5">
      {/* Title row: name + image (click the thumbnail to upload/replace) */}
      <div className="flex flex-wrap items-center gap-2">
        <label
          title={image ? "Click to replace image" : "Click to upload image"}
          className={cx("group relative size-9 shrink-0 cursor-pointer overflow-hidden rounded-lg border", image ? "border-line" : "border-dashed border-line hover:border-ink", busy && "pointer-events-none opacity-50")}
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-[9px] text-muted group-hover:text-ink">{busy ? "…" : "img"}</span>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(async () => setImage(await uploadImage(f))); }} />
        </label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Variation name (e.g. 1.5″ tube)" className={cx(INPUT, "min-w-[160px] flex-1 py-1 text-[12px] font-medium")} />
        {image && <button onClick={() => setImage("")} disabled={busy} className="text-[11px] text-muted hover:text-red-500">Clear</button>}
        <Button variant="primary" busy={busy} disabled={!dirty} className="py-1 text-[11px]" onClick={save}>Save</Button>
        <button onClick={remove} disabled={busy} className="text-[11px] font-medium text-muted hover:text-red-500">Delete</button>
      </div>

      {/* Compatible items: any catalog model, grouped by category (search + scrollable) */}
      <div className="mt-2">
        <div className="mb-1.5 flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter models…"
            className={cx(INPUT, "flex-1 py-1 text-[11.5px]")}
          />
          <span className="text-[10.5px] text-muted">{selCount} selected</span>
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line/60 bg-surface p-1.5">
          {groups.length === 0 ? (
            <p className="px-1 py-2 text-center text-[11px] text-muted">No models match “{q}”.</p>
          ) : (
            groups.map((g) => (
              <CompatCatGroup
                key={g.category.id}
                name={g.category.name}
                models={g.models}
                selected={selected}
                onToggle={toggle}
                forceOpen={needle !== ""}
              />
            ))
          )}
        </div>
      </div>
      {err && <p className="mt-1 text-[11px] text-red-500">{err}</p>}
    </div>
  );
}

/** A collapsible category of checkboxes (the catalog models compatible with this variation). */
function CompatCatGroup({
  name,
  models,
  selected,
  onToggle,
  forceOpen,
}: {
  name: string;
  models: AdminModel[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const count = models.filter((m) => selected.has(m.id)).length;
  const show = open || forceOpen || count > 0;

  return (
    <div className="rounded-md">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-[#faf9f5]">
        <span className="w-3 text-[10px] text-muted">{show ? "▾" : "▸"}</span>
        <span className="text-[11.5px] font-medium text-ink-soft">{name}</span>
        <span className="text-[10px] text-muted/60">· {models.length}</span>
        {count > 0 && <span className="ml-auto rounded-full bg-ink px-1.5 py-px text-[10px] font-medium text-white">{count}</span>}
      </button>
      {show && (
        <div className="flex flex-wrap gap-1 px-1.5 pb-1.5 pl-6">
          {models.map((m) => {
            const on = selected.has(m.id);
            return (
              <button
                key={m.id}
                onClick={() => onToggle(m.id)}
                className={cx(
                  "rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors",
                  on ? "bg-ink text-white ring-ink" : "bg-surface text-ink-soft ring-line hover:bg-[#faf9f5]"
                )}
                title={m.sku}
              >
                {m.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
