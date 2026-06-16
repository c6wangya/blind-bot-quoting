import { OPACITY_LABELS } from "./catalog-data";
import type {
  DraperyPricingConfig,
  ItemConfig,
  Product,
  ProductLine,
  QuoteComputation,
  RollerPricingConfig,
} from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export class PricingError extends Error {}

export function validateConfig(line: ProductLine, product: Product, config: ItemConfig): void {
  if (!product.colors.some((c) => c.id === config.colorId)) {
    throw new PricingError(`Color "${config.colorId}" is not available for ${product.name}`);
  }
  if (!product.validOpacities.includes(config.opacityId)) {
    throw new PricingError(
      `${product.name} is not producible in ${OPACITY_LABELS[config.opacityId] ?? config.opacityId}`
    );
  }
  for (const group of line.optionGroups) {
    const picked = config.options[group.key];
    if (!picked || !group.options.some((o) => o.id === picked)) {
      throw new PricingError(`Missing or invalid option for "${group.label}"`);
    }
  }
  for (const field of line.dimensionFields) {
    const v = config.dimensions[field.key];
    if (typeof v !== "number" || Number.isNaN(v)) {
      throw new PricingError(`Missing dimension "${field.label}"`);
    }
    if (v < field.min || v > field.max) {
      throw new PricingError(
        `${field.label} must be between ${field.min} and ${field.max} ${field.unit}`
      );
    }
  }
}

function priceRoller(
  cfg: RollerPricingConfig,
  product: Product,
  config: ItemConfig,
  line: ProductLine,
  version: string
): QuoteComputation {
  const { width, height } = config.dimensions;
  const wIdx = cfg.gridWidths.findIndex((w) => width <= w);
  const hIdx = cfg.gridHeights.findIndex((h) => height <= h);
  if (wIdx === -1 || hIdx === -1) {
    throw new PricingError("Dimensions exceed the maximum producible size");
  }
  const base = cfg.prices[wIdx][hIdx];
  const tierMult = cfg.tierMultiplier[product.tier];
  const opacityMult = cfg.opacityMultiplier[config.opacityId];
  const fabricPrice = round2(base * tierMult * opacityMult);

  const lines = [
    {
      label: "Base price (size band)",
      detail: `≤${cfg.gridWidths[wIdx]} × ≤${cfg.gridHeights[hIdx]} cm`,
      amount: base,
    },
    {
      label: "Fabric tier & opacity",
      detail: `${product.tier} ×${tierMult} · ${OPACITY_LABELS[config.opacityId]} ×${opacityMult}`,
      amount: round2(fabricPrice - base),
    },
  ];

  let total = fabricPrice;
  for (const group of line.optionGroups) {
    const picked = config.options[group.key];
    const surcharge = cfg.optionSurcharges[group.key]?.[picked] ?? 0;
    if (surcharge > 0) {
      const name = group.options.find((o) => o.id === picked)?.name ?? picked;
      lines.push({ label: group.label, detail: name, amount: surcharge });
      total += surcharge;
    }
  }

  if (total < cfg.minCharge) {
    lines.push({ label: "Minimum order charge", detail: `floor $${cfg.minCharge}`, amount: round2(cfg.minCharge - total) });
    total = cfg.minCharge;
  }

  return {
    unitPrice: round2(total),
    currency: cfg.currency,
    lines,
    facts: [
      { label: "Finished size", value: `${width} × ${height} cm` },
      { label: "Coverage", value: `${round2((width * height) / 10000)} m²` },
      { label: "Price band", value: `W≤${cfg.gridWidths[wIdx]} / H≤${cfg.gridHeights[hIdx]}` },
    ],
    pricingVersion: version,
  };
}

function priceDrapery(
  cfg: DraperyPricingConfig,
  product: Product,
  config: ItemConfig,
  line: ProductLine,
  version: string
): QuoteComputation {
  const { rodWidth, height } = config.dimensions;
  const fullness = cfg.fullnessFactor[config.options.fullness];
  // blind-bot has no "panels" concept — derive it from stack direction:
  // a split stack draws to both sides (a pair); left/right stack is a single panel.
  const panels = config.options.stack === "split" ? 2 : 1;
  if (!fullness) throw new PricingError("Invalid fullness");

  const requiredFabricWidth = rodWidth * fullness;
  const widthsPerPanel = Math.max(1, Math.ceil(requiredFabricWidth / panels / cfg.fabricBoltWidthCm));
  const totalWidths = widthsPerPanel * panels;
  const cutLengthM = (height + cfg.headerAllowanceCm + cfg.hemAllowanceCm) / 100;
  const fabricMeters = round2(totalWidths * cutLengthM);

  const perMeter = cfg.fabricPricePerMeter[product.tier] + cfg.opacitySurchargePerMeter[config.opacityId];
  const fabricCost = round2(fabricMeters * perMeter);

  const makingRate = cfg.makingPerWidth[config.options.header] ?? 0;
  const makingCost = round2(makingRate * totalWidths);

  const liningRate = cfg.liningPerMeter[config.options.liner] ?? 0;
  const liningCost = round2(liningRate * fabricMeters);

  const controlCost = cfg.controlFlat[config.options.control] ?? 0;

  const lines = [
    {
      label: "Fabric",
      detail: `${fabricMeters} m @ $${perMeter}/m (${product.tier}, ${OPACITY_LABELS[config.opacityId]})`,
      amount: fabricCost,
    },
    {
      label: "Making & header",
      detail: `${totalWidths} widths × $${makingRate} (${config.options.header})`,
      amount: makingCost,
    },
  ];
  if (liningCost > 0) {
    lines.push({ label: "Lining", detail: `${fabricMeters} m × $${liningRate}`, amount: liningCost });
  }
  if (controlCost > 0) {
    const name = line.optionGroups
      .find((g) => g.key === "control")
      ?.options.find((o) => o.id === config.options.control)?.name;
    lines.push({ label: "Operation", detail: name ?? config.options.control, amount: controlCost });
  }

  let total = fabricCost + makingCost + liningCost + controlCost;
  if (total < cfg.minCharge) {
    lines.push({ label: "Minimum order charge", detail: `floor $${cfg.minCharge}`, amount: round2(cfg.minCharge - total) });
    total = cfg.minCharge;
  }

  return {
    unitPrice: round2(total),
    currency: cfg.currency,
    lines,
    facts: [
      { label: "Required fabric width", value: `${round2(requiredFabricWidth)} cm (${fullness}× fullness)` },
      { label: "Panels / widths", value: `${panels} panel${panels > 1 ? "s" : ""} · ${totalWidths} fabric widths` },
      { label: "Cut length", value: `${round2(cutLengthM)} m incl. header + hem` },
      { label: "Total fabric", value: `${fabricMeters} m` },
    ],
    pricingVersion: version,
  };
}

export function computeQuote(
  line: ProductLine,
  product: Product,
  config: ItemConfig,
  pricing: RollerPricingConfig | DraperyPricingConfig,
  version: string
): QuoteComputation {
  validateConfig(line, product, config);
  if (pricing.kind === "roller-grid") {
    return priceRoller(pricing, product, config, line, version);
  }
  return priceDrapery(pricing, product, config, line, version);
}
