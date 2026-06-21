import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteDraftButton, RemoveItemButton, SubmitPreOrderButton } from "@/components/QuoteActions";
import { QuoteDetailsDrawer } from "@/components/QuoteDetailsDrawer";
import { LineQtyEditor } from "@/components/LineQtyEditor";
import { Swatch } from "@/components/renders";
import { BackLink, Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { canAccessOwned, requireUserId, userClient } from "@/lib/auth/user";
import { getLine, getOrderRefByQuote, getProduct, getQuote, getQuoteOwnerId, loadCatalog } from "@/lib/db";
import { describeConfig } from "@/lib/describe";
import { fmtDate, usd } from "@/lib/format";
import { isAccessoryConfig } from "@/lib/types";

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </div>
  );
}

function Ref({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="text-[12.5px] text-muted">
      {label}: <span className="text-ink-soft">{value || "—"}</span>
    </div>
  );
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId(`/quotes/${id}`);
  const sb = await userClient();
  const quote = await getQuote(Number(id), sb);
  if (!quote) notFound();

  if (!(await canAccessOwned(userId, await getQuoteOwnerId(Number(id))))) notFound();

  const order =
    quote.status === "converted" ? await getOrderRefByQuote(quote.id, sb) : undefined;
  const catalog = await loadCatalog(); // for accessory line images / names

  const details = {
    quoteType: quote.quoteType,
    projectName: quote.projectName,
    customerName: quote.customerName,
    customerPhone: quote.customerPhone,
    customerEmail: quote.customerEmail,
    shipAddress1: quote.shipAddress1,
    shipAddress2: quote.shipAddress2,
    shipCity: quote.shipCity,
    shipState: quote.shipState,
    shipZip: quote.shipZip,
    po: quote.po,
    sidemark: quote.sidemark,
  };
  const shipLines = [
    quote.shipAddress1,
    quote.shipAddress2,
    [quote.shipCity, quote.shipState, quote.shipZip].filter(Boolean).join(", ") || null,
  ].filter(Boolean) as string[];

  return (
    <div>
      <BackLink href="/quotes">All quotes</BackLink>
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

      {/* Order-critical header details — customer, ship-to, references */}
      <Card className="mb-6 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="grid flex-1 gap-x-8 gap-y-4 sm:grid-cols-3">
            <DetailBlock label="Customer">
              {quote.customerName ? (
                <>
                  <div className="text-[13.5px] font-medium text-ink">{quote.customerName}</div>
                  {quote.customerPhone && <div className="text-[12px] text-muted">{quote.customerPhone}</div>}
                  {quote.customerEmail && <div className="text-[12px] text-muted">{quote.customerEmail}</div>}
                </>
              ) : (
                <span className="text-[12.5px] text-muted">—</span>
              )}
            </DetailBlock>
            <DetailBlock label="Ship to">
              {shipLines.length ? (
                shipLines.map((l, i) => (
                  <div key={i} className="text-[12.5px] text-ink-soft">{l}</div>
                ))
              ) : (
                <span className="text-[12.5px] text-muted">—</span>
              )}
            </DetailBlock>
            <DetailBlock label="References">
              <Ref label="Sidemark" value={quote.sidemark} />
              <Ref label="PO" value={quote.po} />
              <Ref label="Project" value={quote.projectName} />
            </DetailBlock>
          </div>
          {quote.status === "draft" && (
            <QuoteDetailsDrawer quoteId={quote.id} initial={details} />
          )}
        </div>
      </Card>

      {quote.items.length === 0 ? (
        <EmptyState
          title="This quote is empty"
          description="Add configured products from the catalog to build the quote."
          action={<LinkButton href={`/catalog?quote=${quote.id}`}>Add product</LinkButton>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {quote.status === "draft" && (
              <div className="flex flex-wrap justify-end gap-2">
                <LinkButton href={`/catalog?quote=${quote.id}`}>+ Add product</LinkButton>
                <LinkButton href={`/catalog/accessories?quote=${quote.id}`} variant="secondary">
                  + Add accessory
                </LinkButton>
              </div>
            )}
            {quote.items.map((item) => {
              // Accessory line (A-OK motor): fixed price, no color/dimensions.
              if (isAccessoryConfig(item.config)) {
                const cfg = item.config;
                const acc = catalog.model(item.productId);
                const img = cfg.image ?? (acc ? catalog.image(acc) : null);
                return (
                  <Card key={item.id} className="px-5 py-4">
                    <div className="flex gap-4">
                      {img && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={img} alt={cfg.name} className="size-[72px] shrink-0 rounded-2xl bg-[#0e0e10] object-contain p-1.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[15px] font-semibold text-ink">{cfg.name}</div>
                            <div className="mt-0.5 text-xs text-muted">
                              {cfg.brand} · {cfg.category} · {cfg.sku}
                            </div>
                            {cfg.variations?.length ? (
                              <div className="mt-1 text-[11.5px] text-ink-soft">
                                {cfg.variations.map((v) => (
                                  <span key={v.itemId} className="mr-2">
                                    {v.variationName}: <span className="font-medium">{v.itemLabel}</span>
                                  </span>
                                ))}
                              </div>
                            ) : cfg.crownDriver?.mode === "crown-driver" ? (
                              <div className="mt-1 text-[11.5px] text-ink-soft">
                                Crown: <span className="font-medium">{cfg.crownDriver.crownLabel}</span> · Drive:{" "}
                                <span className="font-medium">{cfg.crownDriver.driverLabel}</span>
                              </div>
                            ) : null}
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
                          <div className="mt-3 flex items-center justify-between">
                            <LineQtyEditor itemId={item.id} qty={item.qty} />
                            <RemoveItemButton itemId={item.id} />
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              }

              const product = getProduct(item.productId);
              const line = product ? getLine(item.lineId as string) : null;
              if (!product || !line) {
                // Catalog product no longer exists — render from the line's stored price only.
                return (
                  <Card key={item.id} className="flex items-center justify-between px-5 py-4">
                    <div>
                      <div className="text-[15px] font-semibold text-ink">Product no longer in catalog</div>
                      <div className="mt-0.5 text-xs text-muted">{item.qty} × {usd(item.computation.unitPrice)}</div>
                    </div>
                    <div className="font-semibold tabular-nums text-ink">{usd(item.computation.unitPrice * item.qty)}</div>
                  </Card>
                );
              }
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
                            href={
                              quote.status === "draft"
                                ? `/configure/${product.id}?quote=${quote.id}&item=${item.id}`
                                : `/configure/${product.id}`
                            }
                            className="text-[15px] font-semibold text-ink hover:text-brass"
                          >
                            {product.name}
                          </Link>
                          <div className="mt-0.5 text-xs text-muted">
                            {line.name} · {product.sku} · {desc.colorName} · {desc.opacityLabel}
                          </div>
                          {desc.location && (
                            <div className="mt-1 text-[12px] font-medium text-ink-soft">📍 {desc.location}</div>
                          )}
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
                      {desc.note && (
                        <div className="mt-1 text-[11.5px] italic text-muted">Note: {desc.note}</div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {desc.options.map((o) => (
                          <span key={o} className="rounded-md bg-[#f1efe9] px-2 py-0.5 text-[11px] font-medium text-ink-soft">
                            {o}
                          </span>
                        ))}
                      </div>
                      {quote.status === "draft" && (
                        <div className="mt-3 flex items-center justify-between">
                          <LineQtyEditor itemId={item.id} qty={item.qty} />
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/configure/${product.id}?quote=${quote.id}&item=${item.id}`}
                              className="text-xs font-medium text-brass transition-colors hover:underline"
                            >
                              Edit
                            </Link>
                            <RemoveItemButton itemId={item.id} />
                          </div>
                        </div>
                      )}
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
                <>
                  <SubmitPreOrderButton quoteId={quote.id} total={usd(quote.total)} />
                  <DeleteDraftButton quoteId={quote.id} />
                </>
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
