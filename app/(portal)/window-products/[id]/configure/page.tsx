import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/user";
import { getDefaultOrgId, getQuote, getWindowProduct, getWindowTemplate, listDealerAccounts } from "@/lib/db";
import { isWindowConfig } from "@/lib/window/quote";
import { BackLink, PageHeader } from "@/components/ui";
import WindowConfigurator from "@/components/WindowConfigurator";

export const dynamic = "force-dynamic";

/**
 * Configure & quote one window product. Admin-only in v1 (doubles as the product preview);
 * this same page becomes the dealer configurator when the rollout flag opens it up.
 */
export default async function WindowConfigurePage(ctx: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ quote?: string; item?: string }>;
}) {
  await requireAdminPage("/window-products");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) notFound();

  const product = await getWindowProduct(id);
  if (!product) notFound();
  const template = await getWindowTemplate(product.templateId);
  if (!template) notFound();
  const dealers = await listDealerAccounts(await getDefaultOrgId());

  // ?quote=&item= — edit an existing window line in place.
  const sp = await ctx.searchParams;
  let initial;
  const quoteId = Number(sp.quote);
  const itemId = Number(sp.item);
  if (Number.isInteger(quoteId) && Number.isInteger(itemId)) {
    const quote = await getQuote(quoteId); // admin page → service role fine
    const item = quote?.items.find((i) => i.id === itemId);
    if (quote && item && isWindowConfig(item.config) && quote.status === "draft") {
      initial = { itemId, quoteId, quoteRef: quote.ref, config: item.config, qty: item.qty };
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <BackLink href={`/window-products/${id}`}>{product.name}</BackLink>
      <PageHeader title={`Configure — ${product.name}`} description={template.label} />
      <WindowConfigurator
        product={product}
        template={template}
        dealers={dealers.map((d) => ({ id: d.id, name: d.name }))}
        initial={initial}
      />
    </div>
  );
}
