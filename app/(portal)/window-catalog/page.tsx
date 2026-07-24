import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId, isAdmin } from "@/lib/auth/user";
import { getDefaultOrgId, listWindowProducts, listWindowTemplates, windowDealerAccessFor } from "@/lib/db";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Dealer-facing window catalog: ACTIVE products only, net pricing happens in the configurator.
 * Visible to admins always; to dealer users only once the org's dealerWindowAccess flag is on
 * (until then this page 404s — regular retailers never know it exists).
 */
export default async function WindowCatalogPage() {
  const uid = await requireUserId("/window-catalog");
  const adminUser = await isAdmin(uid);
  if (!adminUser && (await windowDealerAccessFor(uid)) == null) notFound();

  const orgId = await getDefaultOrgId();
  const [products, templates] = await Promise.all([listWindowProducts(orgId), listWindowTemplates()]);
  const active = products.filter((p) => p.status === "active");
  const templateById = new Map(templates.map((t) => [t.id, t]));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Window Products"
        description="Configure custom window coverings and add them straight to a quote."
      />
      {active.length === 0 ? (
        <EmptyState title="No products available" description="Your supplier hasn't published window products yet." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map((p) => (
            <Link key={p.id} href={`/window-catalog/${p.id}`}>
              <Card className="h-full p-5 transition hover:shadow-md">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.imageUrl && <img src={p.imageUrl} alt="" className="mb-3 h-32 w-full rounded-lg object-cover" />}
                <div className="text-[15px] font-semibold text-ink">{p.name}</div>
                <div className="mt-0.5 text-xs text-muted">
                  {templateById.get(p.templateId)?.label ?? ""}
                  {p.sku ? ` · ${p.sku}` : ""}
                </div>
                {p.description && <p className="mt-2 line-clamp-2 text-xs text-ink-soft">{p.description}</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
