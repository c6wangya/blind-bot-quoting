import Link from "next/link";
import { cx, PageHeader } from "@/components/ui";
import { BankSettingsForm } from "@/components/BankSettingsForm";
import { BuyerSettingsForm } from "@/components/BuyerSettingsForm";
import { SellerSettingsForm } from "@/components/SellerSettingsForm";
import { SupplierSettingsForm } from "@/components/SupplierSettingsForm";
import { SyncClientsButton } from "@/components/SyncClientsButton";
import { requireAdminPage } from "@/lib/auth/user";
import { getBankInfo, getBuyerInfo, getSellerInfo, getSuppliers } from "@/lib/db";
import { loadCatalog } from "@/lib/db/accessory-catalog";

export const dynamic = "force-dynamic";

type Tab = "company" | "suppliers" | "bank" | "clients";
const TABS: { id: Tab; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "suppliers", label: "Suppliers" },
  { id: "bank", label: "Bank transfer" },
  { id: "clients", label: "Clients" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireAdminPage("/settings");
  const { tab: tabParam } = await searchParams;
  const tab: Tab = (TABS.find((t) => t.id === tabParam)?.id ?? "company") as Tab;

  return (
    <div>
      <PageHeader eyebrow="Admin Console" title="Settings" description="Company, supplier & account details." />

      <div className="rise mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            className={cx(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-ink text-white" : "border border-line bg-surface text-ink-soft hover:bg-[#faf9f5]"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "company" && <CompanyTab />}
      {tab === "suppliers" && <SuppliersTab />}
      {tab === "bank" && <BankTab />}
      {tab === "clients" && <ClientsTab />}
    </div>
  );
}

async function CompanyTab() {
  const [seller, buyer] = await Promise.all([getSellerInfo(), getBuyerInfo()]);
  return (
    <>
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Invoice / company info</h2>
        <p className="mb-4 max-w-xl text-sm text-muted">
          The seller block printed top-left on customer invoices (name, address, Tax ID). Leave a field blank to fall
          back to the deploy default.
        </p>
        <SellerSettingsForm initial={seller} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Purchasing company (PO buyer)</h2>
        <p className="mb-4 max-w-xl text-sm text-muted">
          Our real purchasing entity (e.g. Quarvia Trade) — the buyer block printed on every supplier purchase order.
          This is separate from the customer-facing brand above.
        </p>
        <BuyerSettingsForm initial={buyer} />
      </section>
    </>
  );
}

async function SuppliersTab() {
  const [catalog, suppliers] = await Promise.all([loadCatalog(), getSuppliers()]);
  const brands = catalog.brands.map((b) => ({ id: b.id, name: b.name }));
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Supplier details per brand</h2>
      <p className="mb-4 max-w-xl text-sm text-muted">
        Each brand is a supplier. The header (name, address, tel, fax, website) and bank details entered here print on
        that brand&apos;s purchase orders alongside the PO buyer info.
      </p>
      <SupplierSettingsForm brands={brands} suppliers={suppliers} />
    </section>
  );
}

async function BankTab() {
  const bank = await getBankInfo();
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Bank transfer details</h2>
      <p className="mb-4 max-w-xl text-sm text-muted">
        Shown to a retailer who chooses bank transfer at checkout. Leave blank to hide.
      </p>
      <BankSettingsForm initial={bank} />
    </section>
  );
}

function ClientsTab() {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Sync blind-bot clients</h2>
      <p className="mb-4 max-w-xl text-sm text-muted">
        Pull retailers from blind-bot into quoting. Creates a login (default password{" "}
        <code className="rounded bg-line/60 px-1">123456Abcde</code>, change-on-first-login prompt) and a profile for
        any client not already here. Safe to run repeatedly — existing accounts are skipped.
      </p>
      <SyncClientsButton />
    </section>
  );
}
