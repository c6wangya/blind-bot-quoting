import { notFound } from "next/navigation";
import { requireAdminPage } from "@/lib/auth/user";
import {
  getDefaultOrgId,
  getWindowProduct,
  getWindowTemplate,
  listDealerAccounts,
  listPriceGroups,
  listSizeConstraints,
  listSurchargeRules,
  loadWindowPricingData,
} from "@/lib/db";
import { BackLink } from "@/components/ui";
import WindowProductEditor from "@/components/WindowProductEditor";

export const dynamic = "force-dynamic";

/** Window product editor: field policies (what's offered) + pricing. Admin-only. */
export default async function WindowProductPage(ctx: { params: Promise<{ id: string }> }) {
  await requireAdminPage("/window-products");
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) notFound();

  const product = await getWindowProduct(id);
  if (!product) notFound();
  const template = await getWindowTemplate(product.templateId);
  if (!template) notFound();

  const orgId = await getDefaultOrgId();
  const [pricingData, groups, surcharges, constraints, dealers] = await Promise.all([
    loadWindowPricingData(orgId, id, null),
    listPriceGroups(orgId),
    listSurchargeRules(orgId, id),
    listSizeConstraints(orgId, id),
    listDealerAccounts(orgId),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <BackLink href="/window-products">Window Products</BackLink>
      <WindowProductEditor
        initialProduct={product}
        template={template}
        initialPricing={{
          priceGroups: groups,
          priceGroupMaps: pricingData.priceGroupMaps,
          priceGrids: pricingData.priceGrids,
          surchargeRules: surcharges,
          sizeConstraints: constraints,
        }}
        dealers={dealers.map((d) => ({ id: d.id, name: d.name }))}
      />
    </div>
  );
}
