import Link from "next/link";
import { Card, cx, PageHeader } from "@/components/ui";
import { TagAdmin } from "@/components/TagAdmin";
import { ModelTagEditor, type TaggableModel } from "@/components/ModelTagEditor";
import { MotorInventoryEditor, type InventoryRow } from "@/components/MotorInventoryEditor";
import { MotorPriceEditor, type PriceRow, type Target } from "@/components/MotorPriceEditor";
import { CrownDriverEditor } from "@/components/CrownDriverEditor";
import { requireAdminPage } from "@/lib/auth/user";
import {
  getAttributes,
  getCrownOptions,
  getDriverOptions,
  getEffectivePrices,
  getInventoryMap,
  getModelTagMap,
  getRetailerOverrideMap,
  listRetailers,
} from "@/lib/db";
import { getAccessoryCategories, getAccessoryModels } from "@/lib/accessories-data";

type Tab = "inventory" | "pricing" | "tags" | "crown-driver";
const TABS: { id: Tab; label: string }[] = [
  { id: "inventory", label: "Inventory" },
  { id: "pricing", label: "Pricing" },
  { id: "tags", label: "Tags" },
  { id: "crown-driver", label: "Crown & Driver" },
];

/** Orderable motor models with category, the surface all motor admin shares. */
function motors() {
  return getAccessoryCategories()
    .filter((c) => c.orderable)
    .flatMap((c) => getAccessoryModels(c.id).map((m) => ({ id: m.id, name: m.name, sku: m.sku, category: c.name })));
}

export default async function MotorsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; retailer?: string }>;
}) {
  await requireAdminPage("/motors");
  const { tab: tabParam, retailer } = await searchParams;
  const tab: Tab = (TABS.find((t) => t.id === tabParam)?.id ?? "inventory") as Tab;

  return (
    <div>
      <PageHeader
        eyebrow="Admin · Motors"
        title="Motor Management"
        description="Everything motor-related in one place — stock, per-retailer pricing, filter tags, and Crown & Driver versions."
      />

      <div className="rise mb-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/motors?tab=${t.id}`}
            className={cx(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-ink text-white" : "border border-line bg-surface text-ink-soft hover:bg-[#faf9f5]"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "inventory" && <InventoryTab />}
      {tab === "pricing" && <PricingTab retailerParam={retailer} />}
      {tab === "tags" && <TagsTab />}
      {tab === "crown-driver" && <CrownDriverTab />}
    </div>
  );
}

async function InventoryTab() {
  const inv = await getInventoryMap();
  const rows: InventoryRow[] = motors().map((m) => ({
    modelId: m.id,
    name: m.name,
    sku: m.sku,
    category: m.category,
    stock: m.id in inv ? inv[m.id] : null,
  }));
  return <MotorInventoryEditor rows={rows} />;
}

async function TagsTab() {
  const [attributes, tagMap] = await Promise.all([getAttributes(), getModelTagMap()]);
  const models: TaggableModel[] = motors().map((m) => ({ id: m.id, name: m.name, sku: m.sku, categoryName: m.category }));
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Attributes</h2>
        <TagAdmin attributes={attributes} />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Tag motors</h2>
        <ModelTagEditor models={models} attributes={attributes} tagMap={tagMap} />
      </section>
    </div>
  );
}

async function CrownDriverTab() {
  const [crown, driver] = await Promise.all([getCrownOptions(), getDriverOptions()]);
  return <CrownDriverEditor crown={crown} driver={driver} />;
}

async function PricingTab({ retailerParam }: { retailerParam?: string }) {
  const retailers = await listRetailers();
  const defaultEffective = await getEffectivePrices(null);

  if (!retailerParam) {
    return (
      <div className="max-w-xl space-y-2">
        <Link href="/motors?tab=pricing&retailer=default" className="block">
          <Card className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-[#faf9f5]">
            <div>
              <div className="text-[14px] font-semibold text-ink">Default pricing</div>
              <div className="text-[12px] text-muted">The baseline every retailer starts from</div>
            </div>
            <span className="text-brass">→</span>
          </Card>
        </Link>
        <div className="px-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Retailers</div>
        {retailers.length === 0 && <div className="px-1 text-[13px] text-muted">No retailer accounts yet.</div>}
        {retailers.map((r) => (
          <Link key={r.id} href={`/motors?tab=pricing&retailer=${r.id}`} className="block">
            <Card className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-[#faf9f5]">
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold text-ink">{r.company ?? r.email}</div>
                <div className="truncate text-[12px] text-muted">{r.email}</div>
              </div>
              <span className="text-brass">→</span>
            </Card>
          </Link>
        ))}
      </div>
    );
  }

  let target: Target;
  let overrideMap: Record<string, number> = {};
  if (retailerParam === "default") {
    target = { kind: "default" };
  } else {
    const r = retailers.find((x) => x.id === retailerParam);
    if (!r) {
      return (
        <Link href="/motors?tab=pricing" className="text-[13px] font-medium text-brass hover:underline">
          ← Back to retailers
        </Link>
      );
    }
    target = { kind: "retailer", retailerId: r.id, label: r.company ?? r.email };
    overrideMap = await getRetailerOverrideMap(r.id);
  }

  const rows: PriceRow[] = motors().map((m) => {
    const defaultPrice = defaultEffective[m.id] ?? 0;
    return {
      modelId: m.id,
      name: m.name,
      sku: m.sku,
      category: m.category,
      defaultPrice,
      currentPrice: target.kind === "retailer" ? overrideMap[m.id] ?? defaultPrice : defaultPrice,
      hasOverride: m.id in overrideMap,
    };
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <Link href="/motors?tab=pricing" className="font-medium text-brass hover:underline">
          ← All retailers
        </Link>
        <span className="text-muted">
          {target.kind === "default" ? "Editing the shared Default tier" : `Overrides for ${target.label}`}
        </span>
      </div>
      <MotorPriceEditor target={target} rows={rows} />
    </div>
  );
}
