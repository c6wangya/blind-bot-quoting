import { requireAdminPage } from "@/lib/auth/user";
import { BackLink, PageHeader } from "@/components/ui";
import WindowPriceBookImport from "@/components/WindowPriceBookImport";

export const dynamic = "force-dynamic";

/** Self-serve Excel price-book import (A.5). Admin only. */
export default async function WindowImportPage() {
  await requireAdminPage("/window-products/import");
  return (
    <div className="mx-auto max-w-4xl">
      <BackLink href="/window-products">Window Products</BackLink>
      <PageHeader
        title="Import price book"
        description="Upload a supplier's Excel price book — W×H matrices are detected automatically and become price-group grids."
      />
      <WindowPriceBookImport />
    </div>
  );
}
