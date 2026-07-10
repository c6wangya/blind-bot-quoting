import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { BankSettingsForm } from "@/components/BankSettingsForm";
import { BuyerSettingsForm } from "@/components/BuyerSettingsForm";
import { SellerSettingsForm } from "@/components/SellerSettingsForm";
import { SyncClientsButton } from "@/components/SyncClientsButton";
import { requireAdminPage } from "@/lib/auth/user";
import { getBankInfo, getBuyerInfo, getSellerInfo } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireAdminPage("/settings");
  const [bank, seller, buyer] = await Promise.all([getBankInfo(), getSellerInfo(), getBuyerInfo()]);
  return (
    <>
      <PageHeader eyebrow="Admin Console" title="Settings" description="Company details shown to retailers." />

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Invoice / company info</h2>
        <p className="mb-4 max-w-xl text-sm text-muted">
          The seller block printed top-left on customer invoices (name, address, Tax ID). Leave a field blank to fall
          back to the deploy default.
        </p>
        <SellerSettingsForm initial={seller} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Purchasing company (PO buyer)</h2>
        <p className="mb-4 max-w-xl text-sm text-muted">
          Our real purchasing entity (e.g. Quarvia Trade) — the buyer block printed on every supplier purchase order.
          This is separate from the customer-facing brand above. Supplier (vendor) details live on the{" "}
          <Link href="/settings/suppliers" className="font-medium text-brass hover:underline">
            Suppliers page
          </Link>
          .
        </p>
        <BuyerSettingsForm initial={buyer} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Bank transfer details</h2>
        <p className="mb-4 max-w-xl text-sm text-muted">
          Shown to a retailer who chooses bank transfer at checkout. Leave blank to hide.
        </p>
        <BankSettingsForm initial={bank} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Sync blind-bot clients</h2>
        <p className="mb-4 max-w-xl text-sm text-muted">
          Pull retailers from blind-bot into quoting. Creates a login (default password{" "}
          <code className="rounded bg-line/60 px-1">123456Abcde</code>, change-on-first-login prompt) and a profile
          for any client not already here. Safe to run repeatedly — existing accounts are skipped.
        </p>
        <SyncClientsButton />
      </section>
    </>
  );
}
