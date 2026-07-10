import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { SupplierSettingsForm } from "@/components/SupplierSettingsForm";
import { requireAdminPage } from "@/lib/auth/user";
import { loadCatalog } from "@/lib/db/accessory-catalog";
import { getSuppliers } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Admin page to maintain each brand's supplier profile (company header + bank details) — printed
 *  on that brand's purchase orders. One profile per brand; PO auto-picks by the line's brand. */
export default async function SuppliersPage() {
  await requireAdminPage("/settings/suppliers");
  const [catalog, suppliers] = await Promise.all([loadCatalog(), getSuppliers()]);
  const brands = catalog.brands.map((b) => ({ id: b.id, name: b.name }));
  return (
    <>
      <PageHeader eyebrow="Admin Console" title="Suppliers" description="Supplier company & bank details per brand." />
      <p className="mb-4 max-w-xl text-sm text-muted">
        Each brand is a supplier. The header (name, address, tel, fax, website) and bank details entered here print on
        that brand&apos;s purchase orders alongside our{" "}
        <Link href="/settings" className="font-medium text-brass hover:underline">
          buyer info
        </Link>
        .
      </p>
      <SupplierSettingsForm brands={brands} suppliers={suppliers} />
    </>
  );
}
