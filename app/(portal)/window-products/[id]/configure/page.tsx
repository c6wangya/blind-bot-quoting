import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/user";
import { getDefaultOrgId, getWindowProduct, getWindowTemplate, listDealerAccounts } from "@/lib/db";
import { BackLink, PageHeader } from "@/components/ui";
import WindowConfigurator from "@/components/WindowConfigurator";

export const dynamic = "force-dynamic";

/**
 * Configure & quote one window product. Admin-only in v1 (doubles as the product preview);
 * this same page becomes the dealer configurator when the rollout flag opens it up.
 */
export default async function WindowConfigurePage(ctx: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/window-products");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) notFound();

  const product = await getWindowProduct(id);
  if (!product) notFound();
  const template = await getWindowTemplate(product.templateId);
  if (!template) notFound();
  const dealers = await listDealerAccounts(await getDefaultOrgId());

  return (
    <div className="mx-auto max-w-6xl">
      <BackLink href={`/window-products/${id}`}>{product.name}</BackLink>
      <PageHeader title={`Configure — ${product.name}`} description={template.label} />
      <WindowConfigurator
        product={product}
        template={template}
        dealers={dealers.map((d) => ({ id: d.id, name: d.name }))}
      />
    </div>
  );
}
