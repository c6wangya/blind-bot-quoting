import Link from "next/link";
import { AccessoryBrowser, type BrowserModel } from "@/components/AccessoryBrowser";
import { AccessoryFilters } from "@/components/AccessoryFilters";
import { AccessorySearchBox } from "@/components/AccessorySearchBox";
import { AccessoryToolbar } from "@/components/AccessoryToolbar";
import { FrequentParts, type FrequentPart } from "@/components/FrequentParts";
import { getEffectiveOwnerId } from "@/lib/auth/acting-as";
import { getCurrentUserId } from "@/lib/auth/user";
import {
  getAttributes,
  getEffectivePrices,
  getFrequentPartIds,
  getInventoryMap,
  getQuotes,
  getModelFilesMap,
  getModelTagMap,
  getProductDefaultsMap,
  getProductVariationMap,
  getRestrictions,
  getVariationItemModelMap,
  getVariations,
  loadCatalog,
} from "@/lib/db";

export default async function AccessoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const cat = typeof sp.cat === "string" ? sp.cat : undefined;
  const quoteId =
    typeof sp.quote === "string" && Number.isInteger(Number(sp.quote)) ? Number(sp.quote) : undefined;
  const q = quoteId ? `&quote=${quoteId}` : "";

  const userId = await getCurrentUserId();
  const [catalog, attributes, tagMap, effectivePrices, inventory, variations, variationMap, filesMap, defaultsMap, restrictions, itemModelMap, frequentRaw] = await Promise.all([
    loadCatalog(),
    getAttributes(),
    getModelTagMap(),
    getEffectivePrices(userId), // this retailer's price per motor (override → default → static)
    getInventoryMap(), // model_id → stock; absent = untracked
    getVariations(),
    getProductVariationMap(), // model_id → available variation item ids
    getModelFilesMap(), // model_id → spec/cert attachments
    getProductDefaultsMap(), // model_id → default variation item ids
    getRestrictions(), // item↔item incompatibility pairs (grey-out in the options modal)
    getVariationItemModelMap(), // variation item_id → its source model id (for stock)
    userId ? getFrequentPartIds(userId, 12) : Promise.resolve([]), // over-fetch; stale ids filtered below
  ]);

  // Each add-on part inherits its source model's stock (absent = untracked / unlimited).
  const variationStock: Record<string, number | null> = {};
  for (const [itemId, modelId] of Object.entries(itemModelMap)) {
    variationStock[itemId] = modelId in inventory ? inventory[modelId] : null;
  }

  // The current user's open (draft) quotes — offered in the in-page "Add to quote" picker so a
  // motor can be dropped into a quote without leaving the catalog.
  const effectiveOwner = await getEffectiveOwnerId();
  const draftQuotes = effectiveOwner
    ? (await getQuotes(effectiveOwner))
        .filter((qu) => qu.status === "draft" && qu.ownerId === effectiveOwner)
        .map((qu) => ({ id: qu.id, ref: qu.ref, projectName: qu.projectName, itemCount: qu.itemCount }))
    : [];

  // Enrich the frequently-ordered ids with the live catalog; drop any that are gone /
  // no longer orderable / unpriced so we never pin a stale suggestion, then keep the top 3.
  const frequentParts: FrequentPart[] = frequentRaw.flatMap(({ modelId, orderCount }) => {
    const model = catalog.model(modelId);
    if (!model) return [];
    const modelCat = catalog.category(model.categoryId);
    if (!modelCat?.orderable) return [];
    const price = effectivePrices[modelId] ?? model.price;
    if (price === null || price === undefined) return [];
    return [{
      modelId,
      name: model.name,
      sku: model.sku,
      image: catalog.image(model),
      price,
      orderCount,
      stock: modelId in inventory ? inventory[modelId] : null,
      availableItemIds: variationMap[modelId] ?? [],
      defaultItemIds: defaultsMap[modelId] ?? [],
      moq: model.moq ?? 0,
    }];
  }).slice(0, 3);
  const categories = catalog.categories;
  const activeCat = categories.find((c) => c.id === cat) ?? categories[0];

  // value id → label, for chips
  const valueLabel: Record<string, string> = {};
  for (const a of attributes) for (const v of a.values) valueLabel[v.id] = v.label;

  // active filters from ?t_<attrId>=<valueId>, plus the ?moq=1 "minimum-order only" toggle
  const selected: Record<string, string> = {};
  for (const a of attributes) {
    const v = sp[`t_${a.id}`];
    if (typeof v === "string" && v) selected[a.id] = v;
  }
  // minimum-order-quantity facet: "1" = only products with a minimum, "0" = only products without
  const moq = sp.moq === "1" ? "1" : sp.moq === "0" ? "0" : "";
  // free-text name/SKU search (raw for the input; lowercased for matching)
  const searchRaw = typeof sp.q === "string" ? sp.q.trim() : "";
  const search = searchRaw.toLowerCase();
  const filtering = Object.keys(selected).length > 0 || moq !== "" || search !== "";

  // Params the search box preserves (everything except q itself).
  const baseParams: Record<string, string> = {};
  if (cat) baseParams.cat = cat;
  if (quoteId) baseParams.quote = String(quoteId);
  for (const [k, v] of Object.entries(selected)) baseParams[`t_${k}`] = v;
  if (moq) baseParams.moq = moq;

  // When filtering, search ALL orderable motors across categories; otherwise browse the active category.
  const baseModels = filtering
    ? categories.filter((c) => c.orderable).flatMap((c) => catalog.modelsIn(c.id).map((m) => ({ model: m, cat: c })))
    : catalog.modelsIn(activeCat.id).map((m) => ({ model: m, cat: activeCat }));

  const filtered = filtering
    ? baseModels.filter(({ model }) => {
        const tags = new Set(tagMap[model.id] ?? []);
        const hasMoq = (model.moq ?? 0) > 0;
        if (moq === "1" && !hasMoq) return false;
        if (moq === "0" && hasMoq) return false;
        if (search && !`${model.name} ${model.sku}`.toLowerCase().includes(search)) return false;
        return Object.values(selected).every((valueId) => tags.has(valueId));
      })
    : baseModels;
  // Products with a minimum-order requirement sink to the bottom (stable sort keeps the rest in
  // their catalog order).
  const models = [...filtered].sort((a, b) => Number((a.model.moq ?? 0) > 0) - Number((b.model.moq ?? 0) > 0));

  // Flatten to serializable rows for the client browser (tags resolved to labels here).
  const browserModels: BrowserModel[] = models.map(({ model, cat: modelCat }) => ({
    id: model.id,
    name: model.name,
    sku: model.sku,
    description: model.description,
    image: catalog.image(model),
    price: effectivePrices[model.id] ?? model.price ?? null,
    stock: model.id in inventory ? inventory[model.id] : null,
    moq: model.moq ?? 0,
    categoryName: modelCat.name,
    orderable: !!modelCat.orderable,
    tags: (tagMap[model.id] ?? []).map((t) => valueLabel[t] ?? t),
    files: (filesMap[model.id] ?? []).map((f) => ({ id: f.id, url: f.url, kind: f.kind, name: f.name })),
    availableItemIds: variationMap[model.id] ?? [],
    defaultItemIds: defaultsMap[model.id] ?? [],
  }));

  // ---- Toolbar data: breadcrumb categories + active-filter chips ----
  const description =
    "Motors, controls and power. Motors are orderable and add to the same quote as full products; other parts are reference for now.";
  const attrName: Record<string, string> = {};
  for (const a of attributes) attrName[a.id] = a.name;

  const buildHref = (sel: Record<string, string>, moqVal: string) => {
    const p = new URLSearchParams();
    if (cat) p.set("cat", cat);
    if (quoteId) p.set("quote", String(quoteId));
    for (const [k, v] of Object.entries(sel)) if (v) p.set(`t_${k}`, v);
    if (moqVal) p.set("moq", moqVal);
    if (searchRaw) p.set("q", searchRaw);
    const qs = p.toString();
    return qs ? `/catalog/accessories?${qs}` : "/catalog/accessories";
  };

  const categoriesData = categories.map((c) => ({
    id: c.id,
    name: c.name,
    count: catalog.modelsIn(c.id).length,
    orderable: !!c.orderable,
    href: `/catalog/accessories?cat=${c.id}${q}`,
    active: !filtering && c.id === activeCat.id,
  }));

  const chips: { label: string; href: string }[] = [];
  for (const [attrId, valueId] of Object.entries(selected)) {
    const rest = { ...selected };
    delete rest[attrId];
    chips.push({ label: `${attrName[attrId] ?? "Filter"}: ${valueLabel[valueId] ?? valueId}`, href: buildHref(rest, moq) });
  }
  if (moq) chips.push({ label: moq === "1" ? "Has minimum order" : "No minimum order", href: buildHref(selected, "") });
  const filterCount = Object.keys(selected).length + (moq ? 1 : 0);
  const activeLabel = filtering ? `Search results · ${models.length}` : activeCat.name;

  return (
    // Full-height, no page scroll — the list + detail pane scroll inside their own card.
    <div className="flex h-[calc(100vh-2.5rem)] flex-col">
      {/* Compact header — description folded into an info tooltip */}
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Parts &amp; Accessories</h1>
        <span className="group relative inline-flex">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="cursor-help text-muted hover:text-ink-soft"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
          <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden w-64 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-[11.5px] font-normal leading-snug text-white shadow-lg group-hover:block">
            {description}
          </span>
        </span>
      </div>

      {quoteId && (
        <div className="rise mb-3 flex items-center justify-between gap-3 rounded-xl border border-brass/40 bg-brass-soft/40 px-4 py-2.5 text-[13px] text-ink-soft">
          <span>Adding to your quote — pick a motor to add.</span>
          <Link href={`/quotes/${quoteId}`} className="shrink-0 font-medium text-brass hover:underline">
            Back to quote →
          </Link>
        </div>
      )}

      <FrequentParts parts={frequentParts} quoteId={quoteId} variations={variations} restrictions={restrictions} />

      <AccessoryToolbar
        brandName={catalog.brand.name}
        categories={categoriesData}
        activeLabel={activeLabel}
        chips={chips}
        clearAllHref={buildHref({}, "")}
        filterCount={filterCount}
        searchSlot={<AccessorySearchBox q={searchRaw} baseParams={baseParams} />}
        filtersSlot={<AccessoryFilters attributes={attributes} selected={selected} moq={moq} q={searchRaw} cat={cat} quote={quoteId} />}
      />

      <div className="min-h-0 flex-1">
        <AccessoryBrowser
          models={browserModels}
          variations={variations}
          restrictions={restrictions}
          variationStock={variationStock}
          quotes={draftQuotes}
          showCategory={filtering}
        />
      </div>
    </div>
  );
}
