import Link from "next/link";
import { AddAccessoryButton } from "@/components/AccessoryActions";
import { Badge, Card, cx, PageHeader } from "@/components/ui";
import {
  ACCESSORY_BRAND,
  accessoryImage,
  getAccessoryCategories,
  getAccessoryModels,
} from "@/lib/accessories-data";
import { usd } from "@/lib/format";

export default async function AccessoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const { cat } = await searchParams;
  const categories = getAccessoryCategories();
  const activeCat = categories.find((c) => c.id === cat) ?? categories[0];
  const models = getAccessoryModels(activeCat.id);

  return (
    <div>
      <PageHeader
        eyebrow="Catalog · Accessories"
        title="Parts & Accessories"
        description="Motors, controls and power — browse by brand and category. Motors are orderable and add to the same quote as full products; other parts are reference for now."
      />

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
                const active = c.id === activeCat.id;
                return (
                  <li key={c.id}>
                    <Link
                      href={`/catalog/accessories?cat=${c.id}`}
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
                      {c.orderable ? (
                        <Badge tone="green">Orderable</Badge>
                      ) : (
                        <Badge tone="slate">Reference</Badge>
                      )}
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
              {ACCESSORY_BRAND.name} · {activeCat.name}
            </span>
            {!activeCat.orderable && (
              <span className="text-[10.5px] text-muted">— reference only (not yet orderable)</span>
            )}
          </div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/70">
              {models.map((model) => (
                <li key={model.id} className="flex items-center gap-4 px-4 py-3.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={accessoryImage(model)}
                    alt={model.name}
                    className="size-14 shrink-0 rounded-xl bg-[#0e0e10] object-contain p-1.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-ink">{model.name}</span>
                      <span className="rounded bg-[#f1efe9] px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft">
                        {model.sku}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted">{model.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-semibold tabular-nums text-ink">
                      {model.price === null ? "Incl." : usd(model.price)}
                    </div>
                    <div className="mt-1.5">
                      {activeCat.orderable && model.price !== null ? (
                        <AddAccessoryButton modelId={model.id} />
                      ) : (
                        <span className="text-[11px] text-muted">Reference</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <p className="mt-3 px-1 text-[11px] text-muted">
            Imported from A-OK 2025 pricing. Images are category-representative for now; per-model photos and any
            catalog corrections come from the A-OK website review.
          </p>
        </div>
      </div>
    </div>
  );
}
