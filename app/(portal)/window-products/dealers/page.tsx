import { requireAdminPage } from "@/lib/auth/user";
import {
  getDefaultOrgId,
  getOrgSettings,
  listAccountFactors,
  listDealerAccounts,
  listDealerUsers,
  listWindowProducts,
  listWindowTemplates,
} from "@/lib/db";
import { BackLink, PageHeader } from "@/components/ui";
import WindowDealersAdmin from "@/components/WindowDealersAdmin";

export const dynamic = "force-dynamic";

/** Dealer accounts, factors, user assignment, and the dealer-rollout switch. Admin only. */
export default async function WindowDealersPage() {
  await requireAdminPage("/window-products/dealers");
  const orgId = await getDefaultOrgId();
  const [accounts, users, settings, templates, products] = await Promise.all([
    listDealerAccounts(orgId),
    listDealerUsers(),
    getOrgSettings(),
    listWindowTemplates(),
    listWindowProducts(orgId),
  ]);
  const factors = await Promise.all(accounts.map((a) => listAccountFactors(a.id)));

  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href="/window-products">Window Products</BackLink>
      <PageHeader
        title="Dealer accounts"
        description="Who buys from you, at what factor, and whether dealers can see the Window Catalog yet."
      />
      <WindowDealersAdmin
        initialAccounts={accounts.map((a, i) => ({ ...a, factors: factors[i] }))}
        initialUsers={users}
        initialAccess={settings.dealerWindowAccess === true}
        initialTaxPct={Number(settings.windowTaxPct ?? 0)}
        lineKeys={templates.map((t) => t.lineKey)}
        products={products.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
