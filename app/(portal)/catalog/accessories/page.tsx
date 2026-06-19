import Link from "next/link";
import { AddAccessoryButton } from "@/components/AccessoryActions";
import { AccessoryFilters } from "@/components/AccessoryFilters";
import { Badge, Card, cx, PageHeader } from "@/components/ui";
import {
  ACCESSORY_BRAND,
  accessoryImage,
  getAccessoryCategories,
  getAccessoryModels,
} from "@/lib/accessories-data";
import { getCurrentUserId } from "@/lib/auth/user";
import {
  getAttributes,
  getCrownOptions,
  getDriverOptions,
  getEffectivePrices,
  getInventoryMap,
  getModelTagMap,
} from "@/lib/db";
import { usd } from "@/lib/format";

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

  const categories = getAccessoryCategories();
  const activeCat = categories.find((c) => c.id === cat) ?? categories[0];

  const userId = await getCurrentUserId();
  const [attributes, tagMap, effectivePrices, inventory, crownOptions, driverOptions] = await Promise.all([
    getAttributes(),
    getModelTagMap(),
    getEffectivePrices(userId), // this retailer's price per motor (override → default → static)
    getInventoryMap(), // model_id → stock; absent = untracked
    getCrownOptions(),
    getDriverOptions(),
  ]);

  // value id → label, for chips
  const valueLabel: Record<string, string> = {};
  for (const a of attributes) for (const v of a.values) valueLabel[v.id] = v.label;

  // active filters from ?t_<attrId>=<valueId>
  const selected: Record<string, string> = {};
  for (const a of attributes) {
    const v = sp[`t_${a.id}`];
    if (typeof v === "string" && v) selected[a.id] = v;
  }
  const filtering = Object.keys(selected).length > 0;

  // When filtering, search ALL orderable motors across categories; otherwise browse the active category.
  const baseModels = filtering
    ? categories.filter((c) => c.orderable).flatMap((c) => getAccessoryModels(c.id).map((m) => ({ model: m, cat: c })))
    : getAccessoryModels(activeCat.id).map((m) => ({ model: m, cat: activeCat }));

  const models = filtering
    ? baseModels.filter(({ model }) => {
        const tags = new Set(tagMap[model.id] ?? []);
        return Object.values(selected).every((valueId) => tags.has(valueId));
      })
    : baseModels;

  return (
    <div>
      <PageHeader
        eyebrow="Catalog · Accessories"
        title="Parts & Accessories"
        description="Motors, controls and power — browse by brand and category, or filter motors by their attributes. Motors are orderable and add to the same quote as full products; other parts are reference for now."
      />

      {quoteId && (
        <div className="rise mb-4 flex items-center justify-between gap-3 rounded-xl border border-brass/40 bg-brass-soft/40 px-4 py-2.5 text-[13px] text-ink-soft">
          <span>Adding to your quote — pick a motor to add.</span>
          <Link href={`/quotes/${quoteId}`} className="shrink-0 font-medium text-brass hover:underline">
            Back to quote →
          </Link>
        </div>
      )}

      <AccessoryFilters attributes={attributes} selected={selected} cat={cat} quote={quoteId} />

      {/* 3-level master-detail: Brand → Category → Models */}
      <div className="grid gap-4 lg:grid-cols-[200px_240px_1fr]">
        {/* L1 — Brand */}
        <div>
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Brand</div>
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3 bg-[#1a2336] px-4 py-3 text-white">
              <div className="flex size-8 items-center justify-center rounded-lg bg-white/10 text-sm font-bold">A</div>
              <div>
                <div className="text-sm font-semibold">{ACCESSORY_BRAND.name}</div>
                <div className="text-[10.5px] text-white/50">{ACCESSORY_BRAND.tagline}</div>
              </div>
            </div>
          </Card>
        </div>

        {/* L2 — Category */}
        <div>
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Category</div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/70">
              {categories.map((c) => {
                const count = getAccessoryModels(c.id).length;
                const active = !filtering && c.id === activeCat.id;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/catalog/accessories?cat=${c.id}${q}`}
                      className={cx(
                        "flex items-center justify-between gap-2 px-4 py-3 transition-colors",
                        active ? "bg-[#fbf8f1]" : "hover:bg-[#faf9f5]"
                      )}
                    >
                      <div className="min-w-0">
                        <div className={cx("truncate text-[13.5px] font-medium", active ? "text-brass" : "text-ink")}>
                          {c.name}
                        </div>
                        <div className="truncate text-[11px] text-muted">{count} models</div>
                      </div>
                      {c.orderable ? <Badge tone="green">Orderable</Badge> : <Badge tone="slate">Reference</Badge>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        {/* L3 — Models */}
        <div>
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              {filtering ? `Filtered · ${models.length} motor${models.length === 1 ? "" : "s"}` : `${ACCESSORY_BRAND.name} · ${activeCat.name}`}
            </span>
            {!filtering && !activeCat.orderable && (
              <span className="text-[10.5px] text-muted">— reference only (not yet orderable)</span>
            )}
          </div>
          <Card className="overflow-hidden">
            {models.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-muted">No models match these filters.</div>
            ) : (
              <ul className="divide-y divide-line/70">
                {models.map(({ model, cat: modelCat }) => {
                  const tags = tagMap[model.id] ?? [];
                  const price = effectivePrices[model.id] ?? model.price;
                  const stock = model.id in inventory ? inventory[model.id] : null;
                  return (
                    <li key={model.id} className="flex items-center gap-4 px-4 py-3.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={accessoryImage(model)}
                        alt={model.name}
                        className="size-14 shrink-0 rounded-xl bg-[#0e0e10] object-contain p-1.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-ink">{model.name}</span>
                          <span className="rounded bg-[#f1efe9] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft">
                            {model.sku}
                          </span>
                          {filtering && <span className="text-[10.5px] text-muted">{modelCat.name}</span>}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">
                          {model.description}
                        </p>
                        {tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-md bg-brass-soft px-1.5 py-0.5 text-[10.5px] font-medium text-[#8a6a39]"
                              >
                                {valueLabel[t] ?? t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[15px] font-semibold tabular-nums text-ink">
                          {price === null ? "Incl." : usd(price)}
                        </div>
                        <div className="mt-1.5">
                          {modelCat.orderable && price !== null ? (
                            <AddAccessoryButton
                              modelId={model.id}
                              quoteId={quoteId}
                              stock={stock}
                              crownOptions={crownOptions}
                              driverOptions={driverOptions}
                            />
                          ) : (
                            <span className="text-[11px] text-muted">Reference</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <p className="mt-3 px-1 text-[11px] text-muted">
            Imported from A-OK 2025 pricing. Stock, pricing, tags and Crown &amp; Driver are managed by an admin under Admin · Motors.
          </p>
        </div>
      </div>
    </div>
  );
}
