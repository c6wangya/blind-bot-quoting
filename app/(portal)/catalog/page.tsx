import Link from "next/link";
import { Badge, Card, cx, PageHeader } from "@/components/ui";
import { OPACITY_LABELS, TIER_LABELS } from "@/lib/catalog-data";
import { getLines, getProducts } from "@/lib/db";

const TIER_TONE: Record<string, string> = {
  standard: "slate",
  premium: "blue",
  designer: "brass",
};

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string }>;
}) {
  const { line } = await searchParams;
  const lines = getLines();
  const activeLine = lines.find((l) => l.id === line) ?? null;
  const products = getProducts(activeLine?.id);

  return (
    <div>
      <PageHeader
        eyebrow="Curated catalog"
        title="Producible Products"
        description="Every pattern below is validated against the supply chain — only producible variation combinations can be quoted. Pick a pattern to configure, render and price it."
      />

      {/* line filter */}
      <div className="rise mb-6 flex gap-2">
        <Link
          href="/catalog"
          className={cx(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
            !activeLine ? "bg-ink text-white" : "border border-line bg-surface text-ink-soft hover:bg-[#faf9f5]"
          )}
        >
          All lines
        </Link>
        {lines.map((l) => (
          <Link
            key={l.id}
            href={`/catalog?line=${l.id}`}
            className={cx(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              activeLine?.id === l.id
                ? "bg-ink text-white"
                : "border border-line bg-surface text-ink-soft hover:bg-[#faf9f5]"
            )}
          >
            {l.name}
          </Link>
        ))}
      </div>

      {activeLine && (
        <p className="rise -mt-2 mb-6 text-sm text-muted">
          {activeLine.description} <span className="text-ink-soft">Lead time ~{activeLine.leadTimeDays} days.</span>
        </p>
      )}

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => {
          const lineName = lines.find((l) => l.id === p.lineId)!.name;
          return (
            <Link key={p.id} href={`/configure/${p.id}`} className="group">
              <Card className="flex h-full flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md">
                <div className="relative aspect-[4/3] overflow-hidden bg-[#f1efe9]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  {p.featured && (
                    <div className="absolute left-3 top-3">
                      <Badge tone="brass">Featured</Badge>
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-[15px] font-semibold text-ink">{p.name}</h3>
                    <Badge tone={TIER_TONE[p.tier]}>{TIER_LABELS[p.tier]}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {lineName} · {p.sku}
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-soft">{p.description}</p>

                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between">
                      <div className="flex -space-x-1.5">
                        {p.colors.map((c) => (
                          <span
                            key={c.id}
                            title={c.name}
                            className="size-5 rounded-full border-2 border-white shadow-sm"
                            style={{ backgroundColor: c.hex }}
                          />
                        ))}
                      </div>
                      <span className="text-xs font-medium text-brass opacity-0 transition-opacity group-hover:opacity-100">
                        Configure →
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line/70 pt-3">
                      {p.validOpacities.map((o) => (
                        <span key={o} className="rounded-md bg-[#f1efe9] px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                          {OPACITY_LABELS[o]}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
