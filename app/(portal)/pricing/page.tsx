import { Badge, Card, PageHeader } from "@/components/ui";
import { OPACITY_LABELS, TIER_LABELS } from "@/lib/catalog-data";
import { requireAdminPage } from "@/lib/auth/user";
import { getAllPricingVersions, getLines } from "@/lib/db";
import { fmtDate, usd } from "@/lib/format";
import type { DraperyPricingConfig, RollerPricingConfig } from "@/lib/types";

function RollerGrid({ cfg }: { cfg: RollerPricingConfig }) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="rounded-l-lg bg-[#f1efe9] px-3 py-2 text-left font-semibold text-ink-soft">
                W \ H (cm)
              </th>
              {cfg.gridHeights.map((h) => (
                <th key={h} className="bg-[#f1efe9] px-3 py-2 text-right font-semibold text-ink-soft last:rounded-r-lg">
                  ≤{h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cfg.gridWidths.map((w, wi) => (
              <tr key={w} className="border-b border-line/50 last:border-0">
                <td className="px-3 py-2 font-semibold text-ink-soft">≤{w}</td>
                {cfg.gridHeights.map((_, hi) => (
                  <td key={hi} className="px-3 py-2 text-right tabular-nums text-ink">
                    {usd(cfg.prices[wi][hi])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 text-[11.5px]">
        {Object.entries(cfg.tierMultiplier).map(([k, v]) => (
          <span key={k} className="rounded-lg bg-[#f1efe9] px-2.5 py-1 text-ink-soft">
            {TIER_LABELS[k]} ×{v}
          </span>
        ))}
        {Object.entries(cfg.opacityMultiplier).map(([k, v]) => (
          <span key={k} className="rounded-lg bg-brass-soft px-2.5 py-1 text-[#8a6a39]">
            {OPACITY_LABELS[k]} ×{v}
          </span>
        ))}
        <span className="rounded-lg bg-[#f1efe9] px-2.5 py-1 text-ink-soft">
          Motorized +{usd(cfg.optionSurcharges.control.motorized)}
        </span>
        <span className="rounded-lg bg-[#f1efe9] px-2.5 py-1 text-ink-soft">
          Cassette +{usd(cfg.optionSurcharges.headrail.cassette)}
        </span>
        <span className="rounded-lg bg-[#f1efe9] px-2.5 py-1 text-ink-soft">Min charge {usd(cfg.minCharge)}</span>
      </div>
    </div>
  );
}

function DraperyFormula({ cfg }: { cfg: DraperyPricingConfig }) {
  return (
    <div className="space-y-3 text-[13px] text-ink-soft">
      <div className="rounded-xl bg-[#f7f5ef] px-4 py-3 font-mono text-[12px] leading-relaxed">
        widths = ceil(rodWidth × fullness ÷ panels ÷ {cfg.fabricBoltWidthCm}cm) × panels
        <br />
        fabric_m = widths × (height + {cfg.headerAllowanceCm} + {cfg.hemAllowanceCm})cm
        <br />
        price = fabric_m × (tier rate + opacity) + widths × making + fabric_m × lining + control
      </div>
      <div className="flex flex-wrap gap-2 text-[11.5px]">
        {Object.entries(cfg.fabricPricePerMeter).map(([k, v]) => (
          <span key={k} className="rounded-lg bg-[#f1efe9] px-2.5 py-1">
            {TIER_LABELS[k]} {usd(v)}/m
          </span>
        ))}
        {Object.entries(cfg.makingPerWidth).map(([k, v]) => (
          <span key={k} className="rounded-lg bg-brass-soft px-2.5 py-1 text-[#8a6a39]">
            {k} making {usd(v)}/width
          </span>
        ))}
        {Object.entries(cfg.liningPerMeter)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => (
            <span key={k} className="rounded-lg bg-[#f1efe9] px-2.5 py-1">
              {k} lining {usd(v)}/m
            </span>
          ))}
        <span className="rounded-lg bg-[#f1efe9] px-2.5 py-1">
          Motorized track +{usd(cfg.controlFlat["motorized-track"])}
        </span>
        <span className="rounded-lg bg-[#f1efe9] px-2.5 py-1">Min charge {usd(cfg.minCharge)}</span>
      </div>
    </div>
  );
}

export default async function PricingPage() {
  await requireAdminPage("/pricing");
  const versions = await getAllPricingVersions();
  const lines = getLines();

  return (
    <div>
      <PageHeader
        eyebrow="Quote formula engine"
        title="Pricing Versions"
        description="Backend formulas that auto-price every configuration. Pricing is versioned — quotes pin the version they were calculated with, so historical quotes stay auditable when rates change."
      />

      <div className="space-y-8">
        {lines.map((line) => {
          const lineVersions = versions.filter((v) => v.lineId === line.id);
          return (
            <section key={line.id}>
              <h2 className="rise mb-3 text-lg font-semibold tracking-tight text-ink">{line.name}</h2>
              <div className="space-y-4">
                {lineVersions.map((v) => (
                  <Card key={v.id} className={v.active ? "" : "opacity-70"}>
                    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
                      <span className="font-mono text-sm font-semibold text-ink">v{v.version}</span>
                      {v.active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Superseded</Badge>}
                      <span className="text-xs text-muted">{v.note}</span>
                      <span className="ml-auto text-xs text-muted">{fmtDate(v.createdAt)}</span>
                    </div>
                    <div className="px-5 py-4">
                      {v.config.kind === "roller-grid" ? (
                        <RollerGrid cfg={v.config} />
                      ) : (
                        <DraperyFormula cfg={v.config} />
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
