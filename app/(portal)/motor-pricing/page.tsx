import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { MotorPriceEditor, type PriceRow, type Target } from "@/components/MotorPriceEditor";
import { requireAdminPage } from "@/lib/auth/user";
import { getEffectivePrices, getRetailerOverrideMap, listRetailers } from "@/lib/db";
import { getAccessoryCategories, getAccessoryModels } from "@/lib/accessories-data";

type MotorMeta = { modelId: string; name: string; sku: string; category: string };

function motorMeta(): MotorMeta[] {
  return getAccessoryCategories()
    .filter((c) => c.orderable)
    .flatMap((c) => getAccessoryModels(c.id).map((m) => ({ modelId: m.id, name: m.name, sku: m.sku, category: c.name })));
}

export default async function MotorPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ retailer?: string }>;
}) {
  await requireAdminPage("/motor-pricing");
  const { retailer: retailerParam } = await searchParams;
  const retailers = await listRetailers();
  const defaultEffective = await getEffectivePrices(null); // default ?? static, per motor

  // ---- selector (no target chosen) ----
  if (!retailerParam) {
    return (
      <div>
        <PageHeader
          eyebrow="Admin · Pricing"
          title="Motor Pricing"
          description="Each retailer can have its own motor prices. Edit the shared Default, or pick a retailer to override. Retailers without an override see the Default."
        />
        <div className="max-w-xl space-y-2">
          <Link href="/motor-pricing?retailer=default" className="block">
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
            <Link key={r.id} href={`/motor-pricing?retailer=${r.id}`} className="block">
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
      </div>
    );
  }

  // ---- a target chosen: Default or a specific retailer ----
  let target: Target;
  let overrideMap: Record<string, number> = {};
  if (retailerParam === "default") {
    target = { kind: "default" };
  } else {
    const r = retailers.find((x) => x.id === retailerParam);
    if (!r) {
      return (
        <div>
          <PageHeader eyebrow="Admin · Pricing" title="Motor Pricing" description="Unknown retailer." />
          <Link href="/motor-pricing" className="text-[13px] font-medium text-brass hover:underline">
            ← Back to retailers
          </Link>
        </div>
      );
    }
    target = { kind: "retailer", retailerId: r.id, label: r.company ?? r.email };
    overrideMap = await getRetailerOverrideMap(r.id);
  }

  const rows: PriceRow[] = motorMeta().map((m) => {
    const defaultPrice = defaultEffective[m.modelId] ?? 0;
    const hasOverride = m.modelId in overrideMap;
    return {
      ...m,
      defaultPrice,
      currentPrice: target.kind === "retailer" ? overrideMap[m.modelId] ?? defaultPrice : defaultPrice,
      hasOverride,
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Admin · Pricing"
        title={`Motor Pricing · ${target.kind === "default" ? "Default" : target.label}`}
        description={
          target.kind === "default"
            ? "These prices are the baseline for every retailer (and editable here)."
            : "Override this retailer's motor prices. Anything left un-overridden follows the Default; use Reset to drop an override."
        }
      />
      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <Link href="/motor-pricing" className="font-medium text-brass hover:underline">
          ← All retailers
        </Link>
        {target.kind === "default" && <span className="text-muted">Editing the shared Default tier</span>}
      </div>
      <MotorPriceEditor target={target} rows={rows} />
      <p className="mt-3 text-[11px] text-muted">
        Prices are snapshotted onto a quote line when the motor is added — changing them here doesn’t alter existing
        quotes. The Default seeds from the A-OK 2025 catalog price until edited.
      </p>
    </div>
  );
}
