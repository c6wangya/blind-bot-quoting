import Link from "next/link";
import { requireAdminPage } from "@/lib/auth/user";
import { getDefaultOrgId, listWindowProducts, listWindowTemplates } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import WindowProductCreate from "@/components/WindowProductCreate";

export const dynamic = "force-dynamic";

/** Window-coverings ERP — merchant product list. Admin-only (v1 surface). */
export default async function WindowProductsPage() {
  await requireAdminPage("/window-products");

  let products: Awaited<ReturnType<typeof listWindowProducts>> = [];
  let templates: Awaited<ReturnType<typeof listWindowTemplates>> = [];
  let setupHint: string | null = null;
  try {
    const orgId = await getDefaultOrgId();
    [products, templates] = await Promise.all([
      listWindowProducts(orgId, { includeArchived: true }),
      listWindowTemplates(),
    ]);
  } catch (err) {
    // Migration 0049 not applied / templates not seeded yet — render setup guidance instead of a 500.
    setupHint = (err as Error).message;
  }

  const templateById = new Map(templates.map((t) => [t.id, t]));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Window Products"
        description="Finished window-covering products your dealers can order — built from platform templates, customized per product."
        actions={
          <div className="flex gap-2">
            <Link href="/window-products/import" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-black/[.03]">
              Import price book
            </Link>
            <Link href="/window-products/dealers" className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-black/[.03]">
              Dealer accounts
            </Link>
          </div>
        }
      />

      {setupHint ? (
        <Card className="p-6">
          <div className="text-sm font-semibold text-ink">Setup required</div>
          <p className="mt-2 text-sm text-ink-soft">
            Run migration <code className="rounded bg-black/5 px-1">supabase/migrations/0049_window_products_core.sql</code>{" "}
            in the Supabase SQL editor, then seed templates with{" "}
            <code className="rounded bg-black/5 px-1">node scripts/seed-window-templates.mjs</code>.
          </p>
          <p className="mt-2 text-xs text-muted">{setupHint}</p>
        </Card>
      ) : (
        <>
          <WindowProductCreate templates={templates.map((t) => ({ id: t.id, label: t.label, lineKey: t.lineKey }))} />

          {products.length === 0 ? (
            <EmptyState
              title="No products yet"
              description="Create your first product from a template above — then customize which options you offer and attach pricing."
            />
          ) : (
            <Card className="mt-6 divide-y divide-line/60 p-0">
              {products.map((p) => {
                const t = templateById.get(p.templateId);
                return (
                  <Link
                    key={p.id}
                    href={`/window-products/${p.id}`}
                    className="flex items-center justify-between px-5 py-4 hover:bg-black/[.02]"
                  >
                    <div>
                      <div className="text-[15px] font-semibold text-ink">{p.name}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        {t?.label ?? p.templateId} · rev {p.templateRevision}
                        {p.sku ? ` · ${p.sku}` : ""}
                      </div>
                    </div>
                    <Badge
                      className={
                        p.status === "active"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : p.status === "archived"
                            ? "border-line bg-black/5 text-muted"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                      }
                    >
                      {p.status}
                    </Badge>
                  </Link>
                );
              })}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
