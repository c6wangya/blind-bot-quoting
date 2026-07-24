import { requireAdminPage } from "@/lib/auth/user";
import { getDefaultOrgId, listDeductionRows, listWindowTemplates } from "@/lib/db";
import { BackLink, PageHeader } from "@/components/ui";
import WindowDeductionsAdmin from "@/components/WindowDeductionsAdmin";

export const dynamic = "force-dynamic";

/** Manufacturing deduction rules editor. Admin only. */
export default async function WindowDeductionsPage() {
  await requireAdminPage("/window-products/deductions");
  const orgId = await getDefaultOrgId();
  const [rows, templates] = await Promise.all([listDeductionRows(orgId), listWindowTemplates()]);
  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href="/window-products">Window Products</BackLink>
      <PageHeader
        title="Deductions"
        description="How ordered sizes become cut sizes — per mount × top style. These drive the MO cut sheets; every edit is a dated revision."
      />
      <WindowDeductionsAdmin
        initialRows={rows}
        lines={templates.map((t) => ({
          lineKey: t.lineKey,
          label: t.label,
          fields: t.fields.map((f) => ({
            key: f.key,
            label: f.label,
            options:
              f.control.kind === "select" || f.control.kind === "color"
                ? (f.control.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))
                : [],
          })),
        }))}
      />
    </div>
  );
}
