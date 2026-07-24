import { notFound } from "next/navigation";
import { requireUserId, isAdmin } from "@/lib/auth/user";
import { getWindowProduct, getWindowTemplate, windowDealerAccessFor } from "@/lib/db";
import { BackLink, PageHeader } from "@/components/ui";
import WindowConfigurator from "@/components/WindowConfigurator";

export const dynamic = "force-dynamic";

/** Dealer configurator: price as THEIR account (server-resolved), add to their draft quote.
 *  Same gate as the catalog — 404 until the org opens dealer access. */
export default async function WindowCatalogConfigurePage(ctx: { params: Promise<{ id: string }> }) {
  const uid = await requireUserId("/window-catalog");
  const adminUser = await isAdmin(uid);
  if (!adminUser && (await windowDealerAccessFor(uid)) == null) notFound();

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) notFound();
  const product = await getWindowProduct(id);
  if (!product || product.status !== "active") notFound();
  const template = await getWindowTemplate(product.templateId);
  if (!template) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <BackLink href="/window-catalog">Window Products</BackLink>
      <PageHeader title={product.name} description={template.label} />
      {/* dealers=[] hides the price-as selector; the server prices dealer users as themselves */}
      <WindowConfigurator product={product} template={template} dealers={[]} />
    </div>
  );
}
