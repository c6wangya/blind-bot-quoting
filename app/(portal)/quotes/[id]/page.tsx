import Link from "next/link";
import { notFound } from "next/navigation";
import { RemoveItemButton, SubmitPreOrderButton } from "@/components/QuoteActions";
import { Swatch } from "@/components/renders";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { canAccessOwned, requireUserId, userClient } from "@/lib/auth/user";
import { getLine, getOrderRefByQuote, getProduct, getQuote, getQuoteOwnerId } from "@/lib/db";
import { accessoryImage, getAccessoryModel } from "@/lib/accessories-data";
import { describeConfig } from "@/lib/describe";
import { fmtDate, usd } from "@/lib/format";
import { isAccessoryConfig } from "@/lib/types";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId(`/quotes/${id}`);
  const sb = await userClient();
  const quote = await getQuote(Number(id), sb);
  if (!quote) notFound();

  if (!(await canAccessOwned(userId, await getQuoteOwnerId(Number(id))))) notFound();

  const order =
    quote.status === "converted" ? await getOrderRefByQuote(quote.id, sb) : undefined;

  return (
    <div>
      <PageHeader
        eyebrow={`Quote · ${fmtDate(quote.createdAt)}`}
        title={quote.ref}
        description={quote.projectName ?? undefined}
        actions={
          quote.status === "draft" ? (
            <Badge tone="amber" className="px-3 py-1 text-[13px]">Draft</Badge>
          ) : (
            <Badge tone="green" className="px-3 py-1 text-[13px]">Converted</Badge>
          )
        }
      />

      {quote.items.length === 0 ? (
        <EmptyState
          title="This quote is empty"
          description="Add configured products from the catalog to build the quote."
          action={<LinkButton href="/catalog">Browse catalog</LinkButton>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {quote.items.map((item) => {
              // Accessory line (A-OK motor): fixed price, no color/dimensions.
              if (isAccessoryConfig(item.config)) {
                const cfg = item.config;
                const acc = getAccessoryModel(item.productId);
                return (
                  <Card key={item.id} className="px-5 py-4">
                    <div className="flex gap-4">
                      {acc && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={accessoryImage(acc)} alt={cfg.name} className="size-[72px] shrink-0 rounded-2xl bg-[#0e0e10] object-contain p-1.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[15px] font-semibold text-ink">{cfg.name}</div>
                            <div className="mt-0.5 text-xs text-muted">
                              {cfg.brand} · {cfg.category} · {cfg.sku}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold tabular-nums text-ink">
                              {usd(item.computation.unitPrice * item.qty)}
                            </div>
                            <div className="text-xs text-muted">
                              {item.qty} × {usd(item.computation.unitPrice)}
                            </div>
                          </div>
                        </div>
                        {quote.status === "draft" && (
                          <div className="mt-2 flex justify-end">
                            <RemoveItemButton itemId={item.id} />
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              }

              const product = getProduct(item.productId)!;
              const line = getLine(item.lineId as string)!;
              const desc = describeConfig(line, product, item.config);
              return (
                <Card key={item.id} className="px-5 py-4">
                  <div className="flex gap-4">
                    {desc.color && (
                      <Swatch color={desc.color} patternStyle={product.patternStyle} size={72} rounded={16} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Link
                            href={`/configure/${product.id}`}
                            className="text-[15px] font-semibold text-ink hover:text-brass"
                          >
                            {product.name}
                          </Link>
                          <div className="mt-0.5 text-xs text-muted">
                            {line.name} · {product.sku} · {desc.colorName} · {desc.opacityLabel}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold tabular-nums text-ink">
                            {usd(item.computation.unitPrice * item.qty)}
                          </div>
                          <div className="text-xs text-muted">
                            {item.qty} × {usd(item.computation.unitPrice)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-[12.5px] text-ink-soft">{desc.dims}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {desc.options.map((o) => (
                          <span key={o} className="rounded-md bg-[#f1efe9] px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                            {o}
                          </span>
                        ))}
                        <span className="ml-auto">
                          {quote.status === "draft" && <RemoveItemButton itemId={item.id} />}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div>
            <div className="sticky top-8 space-y-4">
              <Card className="px-5 py-5">
                <h3 className="text-sm font-semibold text-ink">Summary</h3>
                <dl className="mt-3 space-y-2 text-[13px]">
                  <div className="flex justify-between">
                    <dt className="text-muted">Line items</dt>
                    <dd className="font-medium tabular-nums text-ink">{quote.items.length}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Units</dt>
                    <dd className="font-medium tabular-nums text-ink">
                      {quote.items.reduce((s, i) => s + i.qty, 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted">Pricing version</dt>
                    <dd className="font-medium text-ink">
                      {[...new Set(quote.items.map((i) => `v${i.computation.pricingVersion}`))].join(", ")}
                    </dd>
                  </div>
                  <div className="flex justify-between border-t border-line pt-2.5 text-[15px]">
                    <dt className="font-semibold text-ink">Total · FOB</dt>
                    <dd className="font-semibold tabular-nums text-ink">{usd(quote.total)}</dd>
                  </div>
                </dl>
              </Card>

              {quote.status === "draft" ? (
                <SubmitPreOrderButton quoteId={quote.id} total={usd(quote.total)} />
              ) : (
                order && (
                  <LinkButton href={`/orders/${order.id}`} className="w-full justify-center">
                    View pre-order {order.ref} →
                  </LinkButton>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
