import { PageHeader } from "@/components/ui";
import { BankSettingsForm } from "@/components/BankSettingsForm";
import { SellerSettingsForm } from "@/components/SellerSettingsForm";
import { requireAdminPage } from "@/lib/auth/user";
import { getBankInfo, getSellerInfo } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdminPage("/settings");
  const [bank, seller] = await Promise.all([getBankInfo(), getSellerInfo()]);
  return (
    <>
      <PageHeader eyebrow="Admin Console" title="Settings" description="Company details shown to retailers." />

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Invoice / company info</h2>
        <p className="mb-4 max-w-xl text-sm text-muted">
          The seller block printed top-left on invoices &amp; purchase orders (name, address, Tax ID). Leave a field
          blank to fall back to the deploy default.
        </p>
        <SellerSettingsForm initial={seller} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Bank transfer details</h2>
        <p className="mb-4 max-w-xl text-sm text-muted">
          Shown to a retailer who chooses bank transfer at checkout. Leave blank to hide.
        </p>
        <BankSettingsForm initial={bank} />
      </section>
    </>
  );
}
