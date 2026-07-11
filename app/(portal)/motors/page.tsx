import Link from "next/link";
import { Card, cx, PageHeader } from "@/components/ui";
import { TagAdmin } from "@/components/TagAdmin";
import { ModelTagEditor, type TaggableModel } from "@/components/ModelTagEditor";
import { MotorInventoryEditor, type InventoryRow } from "@/components/MotorInventoryEditor";
import { MotorPriceEditor, type PriceRow, type Target } from "@/components/MotorPriceEditor";
import { MotorShippingEditor, type ShippingRow } from "@/components/MotorShippingEditor";
import { BusinessPricingToggle } from "@/components/BusinessPricingToggle";
import { RetailerDiscountEditor } from "@/components/RetailerDiscountEditor";
import { RetailerPricingList } from "@/components/RetailerPricingList";
import { WaiveShippingEditor } from "@/components/WaiveShippingEditor";
import { VariationsAdmin, type VariationProduct } from "@/components/VariationsAdmin";
import { RetailerDefaultsAdmin, RetailerKitPicker, type KitProduct } from "@/components/RetailerDefaultsAdmin";
import { CatalogAdmin } from "@/components/CatalogAdmin";
import { requireAdminPage } from "@/lib/auth/user";
import {
  getAttributes,
  getBusinessPriceMap,
  getCatalogCreatedAt,
  getEffectivePrices,
  getInventoryMap,
  isBusinessPricingEnabled,
  getModelFilesMap,
  getModelTagMap,
  getProductDefaultsMap,
  getProductVariationMap,
  getExclusionGroupsMap,
  getRetailerDefaultsMap,
  getRetailerDiscount,
  getRetailerOverrideMap,
  getShippingWaivers,
  getVariations,
  listRetailers,
  loadCatalog,
  loadCatalogAdmin,
} from "@/lib/db";

type Tab = "catalog" | "inventory" | "pricing" | "shipping" | "tags" | "variations" | "defaults";
const TABS: { id: Tab; label: string }[] = [
  { id: "catalog", label: "Catalog" },
  { id: "inventory", label: "Inventory" },
  { id: "pricing", label: "Pricing" },
  { id: "shipping", label: "Shipping" },
  { id: "tags", label: "Tags" },
  { id: "variations", label: "Variations" },
  { id: "defaults", label: "Customer kits" },
];

/** Orderable motor models with category, the surface inventory/pricing/shipping share. */
async function motors() {
  const [cat, createdAt] = await Promise.all([loadCatalog(), getCatalogCreatedAt()]);
  const rows = cat.categories
    .filter((c) => c.orderable)
    .flatMap((c) => {
      const brandId = c.brandId ?? "";
      const brand = cat.brands.find((b) => b.id === brandId)?.name ?? cat.brand.name;
      return cat.modelsIn(c.id).map((m) => ({
        id: m.id, name: m.name, sku: m.sku, category: c.name, brand, brandId, moq: m.moq ?? 0,
        shipGround: m.shipGround ?? 0, shipExpedite: m.shipExpedite ?? 0,
        shipMode: m.shipMode ?? "fob",
      }));
    });
  // Order by brand creation time, then model creation time — earliest created first.
  return rows.sort((a, b) => {
    const bt = (createdAt.brands[a.brandId] ?? "").localeCompare(createdAt.brands[b.brandId] ?? "");
    return bt !== 0 ? bt : (createdAt.models[a.id] ?? "").localeCompare(createdAt.models[b.id] ?? "");
  });
}

/** Every accessory catalog model with its category — variations can apply to any product. */
async function allProducts(): Promise<VariationProduct[]> {
  const cat = await loadCatalog();
  return cat.models.map((m) => ({
    id: m.id,
    name: m.name,
    sku: m.sku,
    categoryName: cat.category(m.categoryId)?.name ?? "",
  }));
}

export default async function MotorsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; retailer?: string }>;
}) {
  await requireAdminPage("/motors");
  const { tab: tabParam, retailer } = await searchParams;
  const tab: Tab = (TABS.find((t) => t.id === tabParam)?.id ?? "catalog") as Tab;

  return (
    <div>
      <PageHeader
        eyebrow="Admin · Motors"
        title="Motor Management"
        description="Everything motor-related in one place — stock, per-retailer pricing, filter tags, and product variations."
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

      {tab === "catalog" && <CatalogTab />}
      {tab === "inventory" && <InventoryTab />}
      {tab === "pricing" && <PricingTab retailerParam={retailer} />}
      {tab === "shipping" && <ShippingTab />}
      {tab === "tags" && <TagsTab />}
      {tab === "variations" && <VariationsTab />}
      {tab === "defaults" && <DefaultsTab retailerParam={retailer} />}
    </div>
  );
}

async function CatalogTab() {
  const [catalog, files] = await Promise.all([loadCatalogAdmin(), getModelFilesMap()]);
  return <CatalogAdmin catalog={catalog} files={files} />;
}

async function InventoryTab() {
  const inv = await getInventoryMap();
  const rows: InventoryRow[] = (await motors()).map((m) => ({
    modelId: m.id,
    name: m.name,
    sku: m.sku,
    category: m.category,
    stock: m.id in inv ? inv[m.id] : null,
  }));
  return <MotorInventoryEditor rows={rows} />;
}

async function ShippingTab() {
  const rows: ShippingRow[] = (await motors()).map((m) => ({
    modelId: m.id,
    name: m.name,
    sku: m.sku,
    category: m.category,
    brand: m.brand,
    mode: m.shipMode,
    ground: m.shipGround,
    expedite: m.shipExpedite,
  }));
  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-[13px] leading-relaxed text-muted">
        Set where each motor is made: <b>FOB</b> (China — air/sea, no domestic freight) or <b>US Ground</b>
        (domestic freight at the per-unit rates below). A quote prices shipping per item by its mode.
        <b> 0 = free</b> (e.g. crown/drive parts). Standard ground is waived on orders ≥ $1,000 or for
        waived retailers; <b>expedite is always charged</b>.
      </p>
      <MotorShippingEditor rows={rows} />
    </div>
  );
}

async function TagsTab() {
  const [attributes, tagMap] = await Promise.all([getAttributes(), getModelTagMap()]);
  const models: TaggableModel[] = (await motors()).map((m) => ({ id: m.id, name: m.name, sku: m.sku, categoryName: m.category, moq: m.moq }));
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

async function VariationsTab() {
  const [variations, assignment, defaults, products, exclusionGroups] = await Promise.all([
    getVariations(),
    getProductVariationMap(),
    getProductDefaultsMap(),
    allProducts(),
    getExclusionGroupsMap(),
  ]);
  return <VariationsAdmin variations={variations} products={products} assignment={assignment} defaults={defaults} exclusionGroups={exclusionGroups} />;
}

/**
 * "Customer kits" — per-customer default variation items. Pick a retailer, then pre-select which
 * sub-products auto-fill for them when they open a model on the accessory page. Mirrors the
 * Pricing tab's retailer-picker flow (shares the `?retailer=` param).
 */
async function DefaultsTab({ retailerParam }: { retailerParam?: string }) {
  const retailers = await listRetailers();

  if (!retailerParam) {
    return (
      <div className="max-w-4xl space-y-3">
        <p className="text-[13px] text-muted">
          Choose a customer to set up their default parts. When they shop the accessory catalog, the parts you pick
          here auto-select for them.
        </p>
        <RetailerKitPicker retailers={retailers} />
      </div>
    );
  }

  const r = retailers.find((x) => x.id === retailerParam);
  if (!r) {
    return (
      <div className="max-w-4xl">
        <Link href="/motors?tab=defaults" className="text-[13px] text-brass hover:underline">← Back to customers</Link>
        <p className="mt-3 text-[13px] text-muted">That customer no longer exists.</p>
      </div>
    );
  }

  const [variations, assignment, exclusionGroups, globalDefaults, retailerDefaults, all] = await Promise.all([
    getVariations(),
    getProductVariationMap(),
    getExclusionGroupsMap(),
    getProductDefaultsMap(),
    getRetailerDefaultsMap(r.id),
    allProducts(),
  ]);
  // Only products that actually have variation items assigned can be kitted.
  const products: KitProduct[] = all
    .filter((p) => (assignment[p.id]?.length ?? 0) > 0)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, categoryName: p.categoryName, assigned: assignment[p.id] ?? [] }));

  return (
    <div className="max-w-4xl space-y-3">
      <Link href="/motors?tab=defaults" className="text-[13px] text-brass hover:underline">← Back to customers</Link>
      <h2 className="text-lg font-semibold tracking-tight text-ink">Default parts for {r.company ?? r.email}</h2>
      <RetailerDefaultsAdmin
        retailerId={r.id}
        retailerLabel={r.company ?? r.email}
        products={products}
        variations={variations}
        exclusionGroups={exclusionGroups}
        globalDefaults={globalDefaults}
        retailerDefaults={retailerDefaults}
      />
    </div>
  );
}

async function PricingTab({ retailerParam }: { retailerParam?: string }) {
  const retailers = await listRetailers();
  const defaultEffective = await getEffectivePrices(null);

  if (!retailerParam) {
    return (
      <div className="max-w-4xl space-y-2">
        <Link href="/motors?tab=pricing&retailer=default" className="block">
          <Card className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-[#faf9f5]">
            <div>
              <div className="text-[14px] font-semibold text-ink">Default pricing</div>
              <div className="text-[12px] text-muted">The retail baseline every self-serve customer sees</div>
            </div>
            <span className="text-brass">→</span>
          </Card>
        </Link>
        <Link href="/motors?tab=pricing&retailer=business" className="block">
          <Card className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-[#faf9f5]">
            <div>
              <div className="text-[14px] font-semibold text-ink">Business pricing</div>
              <div className="text-[12px] text-muted">The shared wholesale tier for authorized customers</div>
            </div>
            <span className="text-brass">→</span>
          </Card>
        </Link>
        <RetailerPricingList retailers={retailers} />
      </div>
    );
  }

  let target: Target;
  let overrideMap: Record<string, number> = {};
  let businessMap: Record<string, number> = {};
  let discountPct = 0;
  let waivers = { ground: false, expedite: false };
  let businessEnabled = false;
  if (retailerParam === "default") {
    target = { kind: "default" };
  } else if (retailerParam === "business") {
    target = { kind: "business" };
    businessMap = await getBusinessPriceMap();
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
    [overrideMap, businessMap, discountPct, waivers, businessEnabled] = await Promise.all([
      getRetailerOverrideMap(r.id),
      getBusinessPriceMap(),
      getRetailerDiscount(r.id),
      getShippingWaivers(r.id),
      isBusinessPricingEnabled(r.id),
    ]);
  }

  const rows: PriceRow[] = (await motors()).map((m) => {
    const defaultPrice = defaultEffective[m.id] ?? 0;
    return {
      modelId: m.id,
      name: m.name,
      sku: m.sku,
      category: m.category,
      brand: m.brand,
      defaultPrice,
      businessPrice: businessMap[m.id] ?? defaultPrice,
      // "This retailer" = the customer's actually-effective price, mirroring resolveMotorPrice:
      // override ?? (business tier, if authorized) ?? default. Seeding the input to the true
      // effective price means an un-overridden row that's already following the Business tier
      // shows the Business price (not Default) and stays override-free unless the admin edits it.
      currentPrice:
        target.kind === "retailer"
          ? overrideMap[m.id] ?? (businessEnabled ? businessMap[m.id] : undefined) ?? defaultPrice
          : target.kind === "business"
            ? businessMap[m.id] ?? defaultPrice
            : defaultPrice,
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
          {target.kind === "default"
            ? "Editing the shared Default tier"
            : target.kind === "business"
              ? "Editing the shared Business tier"
              : `Overrides for ${target.label}`}
        </span>
      </div>
      {target.kind === "retailer" && (
        <Card className="mb-4 divide-y divide-line">
          <BusinessPricingToggle retailerId={target.retailerId} label={target.label} initialEnabled={businessEnabled} />
          <RetailerDiscountEditor retailerId={target.retailerId} label={target.label} initialPct={discountPct} />
          <WaiveShippingEditor
            retailerId={target.retailerId}
            label={target.label}
            initialGround={waivers.ground}
            initialExpedite={waivers.expedite}
          />
        </Card>
      )}
      <MotorPriceEditor key={retailerParam} target={target} rows={rows} />
    </div>
  );
}
