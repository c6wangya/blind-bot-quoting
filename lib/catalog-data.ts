import type {
  DraperyPricingConfig,
  Product,
  ProductLine,
  RollerPricingConfig,
} from "./types";

/**
 * Catalog sourced from blind-bot beta (THE-772 real-catalog).
 * Option vocabulary comes from the blind-bot subcategory schemas (roller_shade=1,
 * drapery_panel=17); product names + photos from the real beta products
 * (Roller Shade #877, Standard Drapery #873). Raw snapshot lives in
 * docs/blind-bot-beta-snapshot/. Upstream has no price/tier/SKU/dimensions —
 * those are defined here on the quote side. See the design spec under
 * docs/superpowers/specs/2026-06-16-real-catalog-from-beta-design.md.
 */

// Per-line opacity vocabularies differ (roller "privacy" vs drapery "semi-sheer"),
// so labels are keyed across both lines' ids.
export const OPACITY_LABELS: Record<string, string> = {
  sheer: "Sheer",
  "light-filtering": "Light Filtering",
  privacy: "Privacy",
  blackout: "Blackout",
  "semi-sheer": "Semi-Sheer",
  opaque: "Opaque",
};

export const TIER_LABELS: Record<string, string> = {
  standard: "Standard",
  premium: "Premium",
  designer: "Designer",
};

export const PRODUCT_LINES: ProductLine[] = [
  {
    id: "roller-shade",
    name: "Roller Shade",
    tagline: "Clean, minimal light control",
    description:
      "Factory-direct custom roller shades with cassette, fascia or open-roll headrails, manual, cordless or motorized control.",
    leadTimeDays: 18,
    dimensionFields: [
      { key: "width", label: "Width", unit: "cm", min: 30, max: 300, step: 0.5, help: "Finished width including brackets" },
      { key: "height", label: "Height (drop)", unit: "cm", min: 40, max: 350, step: 0.5, help: "Top of headrail to bottom bar, fully lowered" },
    ],
    opacities: [
      { id: "sheer", name: "Sheer" },
      { id: "light-filtering", name: "Light Filtering" },
      { id: "privacy", name: "Privacy" },
      { id: "blackout", name: "Blackout" },
    ],
    optionGroups: [
      {
        key: "mount",
        label: "Mount",
        options: [
          { id: "inside", name: "Inside mount", hint: "Fits within the window recess" },
          { id: "outside", name: "Outside mount", hint: "Overlaps the window frame" },
          { id: "ceiling", name: "Ceiling mount" },
        ],
      },
      {
        key: "control",
        label: "Control",
        options: [
          { id: "manual", name: "Manual" },
          { id: "cordless", name: "Cordless" },
          { id: "motorized", name: "Motorized", hint: "Rechargeable, remote included" },
        ],
      },
      {
        key: "headrail",
        label: "Top treatment",
        options: [
          { id: "open-roll", name: "Open roll" },
          { id: "white-cassette", name: "White cassette", hint: "Fabric-wrapped enclosure" },
          { id: "black-cassette", name: "Black cassette" },
          { id: "brown-cassette", name: "Brown cassette" },
          { id: "grey-cassette", name: "Grey cassette" },
          { id: "valance", name: "Valance" },
          { id: "fascia", name: "Fascia" },
        ],
      },
      {
        key: "sideChannel",
        label: "Side channel",
        options: [
          { id: "none", name: "None" },
          { id: "black", name: "Black" },
          { id: "white", name: "White" },
          { id: "brown", name: "Brown" },
        ],
      },
    ],
  },
  {
    id: "drapery",
    name: "Drapery",
    tagline: "Tailored softness, made to measure",
    description:
      "Custom-sewn drapery panels cut from full-width bolts, with pinch, euro, goblet pleat, ripplefold, grommet or rod-pocket headers.",
    leadTimeDays: 22,
    dimensionFields: [
      { key: "rodWidth", label: "Rod / track width", unit: "cm", min: 60, max: 600, step: 0.5, help: "End to end, excluding finials" },
      { key: "height", label: "Finished height", unit: "cm", min: 80, max: 400, step: 0.5, help: "Top of header to hem" },
    ],
    opacities: [
      { id: "sheer", name: "Sheer" },
      { id: "semi-sheer", name: "Semi-Sheer" },
      { id: "opaque", name: "Opaque" },
      { id: "blackout", name: "Blackout" },
    ],
    optionGroups: [
      {
        key: "fullness",
        label: "Fullness",
        options: [
          { id: "2x", name: "2.0× · Standard" },
          { id: "2.5x", name: "2.5× · Deluxe" },
          { id: "3x", name: "3.0× · Luxury" },
        ],
      },
      {
        key: "header",
        label: "Header style",
        options: [
          { id: "pinch-pleat", name: "Pinch pleat" },
          { id: "euro-pleat", name: "Euro pleat" },
          { id: "goblet-pleat", name: "Goblet pleat" },
          { id: "ripplefold", name: "Ripplefold" },
          { id: "grommet", name: "Grommet" },
          { id: "rod-pocket", name: "Rod pocket" },
          { id: "back-tab", name: "Back tab" },
        ],
      },
      {
        key: "liner",
        label: "Liner",
        options: [
          { id: "unlined", name: "Unlined" },
          { id: "privacy", name: "Privacy liner" },
          { id: "blackout", name: "Blackout liner" },
          { id: "interlined", name: "Interlined" },
        ],
      },
      {
        key: "control",
        label: "Operation",
        options: [
          { id: "baton-draw", name: "Baton draw" },
          { id: "cord-draw", name: "Cord draw" },
          { id: "motorized-somfy", name: "Motorized (Somfy)", hint: "Quiet DC motor, app + remote" },
        ],
      },
      {
        key: "stack",
        label: "Stack direction",
        options: [
          { id: "split", name: "Split stack", hint: "Pair, draws to both sides" },
          { id: "left", name: "Left stack", hint: "Single panel" },
          { id: "right", name: "Right stack", hint: "Single panel" },
        ],
      },
      {
        key: "rodColor",
        label: "Rod color",
        options: [
          { id: "white", name: "White" },
          { id: "matte-black", name: "Matte Black" },
          { id: "polished-brass", name: "Polished Brass" },
          { id: "antique-brass", name: "Antique Brass" },
          { id: "oil-rubbed-bronze", name: "Oil-Rubbed Bronze" },
          { id: "satin-nickel", name: "Satin Nickel" },
          { id: "polished-chrome", name: "Polished Chrome" },
          { id: "dark-wood", name: "Dark Wood" },
          { id: "light-wood", name: "Light Wood" },
        ],
      },
    ],
  },
];

export const PRODUCTS: Product[] = [
  {
    id: "rs-roller-shade",
    lineId: "roller-shade",
    sku: "RS-RLR-001",
    name: "Roller Shade",
    description:
      "Factory-direct roller shade — woven face fabric with cassette, fascia or open-roll top treatments and optional side channels.",
    tier: "premium",
    imageUrl: "/catalog/roller-shade/00.jpg",
    galleryImages: [
      "/catalog/roller-shade/01.jpg",
      "/catalog/roller-shade/02.jpg",
      "/catalog/roller-shade/03.jpg",
      "/catalog/roller-shade/04.jpg",
      "/catalog/roller-shade/05.jpg",
    ],
    patternStyle: "weave",
    colors: [
      { id: "white", name: "White", hex: "#FFFFFF" },
      { id: "cream", name: "Cream", hex: "#FFFDD0" },
      { id: "tan", name: "Tan", hex: "#D2B48C" },
      { id: "gray", name: "Gray", hex: "#808080" },
      { id: "charcoal", name: "Charcoal", hex: "#36454F" },
    ],
    validOpacities: ["sheer", "light-filtering", "privacy", "blackout"],
    featured: true,
  },
  {
    id: "dp-standard-drapery",
    lineId: "drapery",
    sku: "DP-STD-001",
    name: "Standard Drapery",
    description:
      "Custom-sewn drapery panels with a soft, tailored break — choose pleat header, liner, fullness and rod finish.",
    tier: "premium",
    imageUrl: "/catalog/drapery/00.jpg",
    galleryImages: [
      "/catalog/drapery/01.jpg",
      "/catalog/drapery/02.jpg",
      "/catalog/drapery/03.jpg",
      "/catalog/drapery/04.jpg",
    ],
    patternStyle: "linen",
    colors: [
      { id: "white", name: "White", hex: "#FFFFFF", accentHex: "#ECE9E0" },
      { id: "grey", name: "Grey", hex: "#808080", accentHex: "#6F6F6F" },
    ],
    validOpacities: ["sheer", "semi-sheer", "opaque", "blackout"],
    featured: true,
  },
];

export const ROLLER_PRICING_V1: RollerPricingConfig = {
  kind: "roller-grid",
  currency: "USD",
  gridWidths: [60, 100, 140, 180, 220, 260, 300],
  gridHeights: [100, 160, 220, 280, 350],
  prices: [
    [39, 46, 54, 63, 74],
    [52, 61, 72, 85, 99],
    [66, 78, 92, 108, 126],
    [81, 96, 113, 132, 154],
    [97, 115, 135, 158, 184],
    [114, 135, 159, 186, 216],
    [132, 156, 184, 215, 250],
  ],
  tierMultiplier: { standard: 1.0, premium: 1.28, designer: 1.55 },
  opacityMultiplier: {
    sheer: 0.95,
    "light-filtering": 1.0,
    privacy: 1.1,
    blackout: 1.28,
  },
  optionSurcharges: {
    control: { manual: 0, cordless: 12, motorized: 90 },
    headrail: {
      "open-roll": 0,
      "white-cassette": 32,
      "black-cassette": 32,
      "brown-cassette": 34,
      "grey-cassette": 32,
      valance: 24,
      fascia: 28,
    },
    mount: { inside: 0, outside: 0, ceiling: 6 },
    sideChannel: { none: 0, black: 18, white: 18, brown: 20 },
  },
  minCharge: 49,
};

/**
 * 2026.2 — Q2 freight adjustment: motorized +$5 (90→95), blackout multiplier 1.28→1.30.
 * The active version. Quotes priced before this took effect stay pinned to 2026.1,
 * so the version lock is observable: re-pricing an old config yields a different total.
 */
export const ROLLER_PRICING_V2: RollerPricingConfig = {
  ...ROLLER_PRICING_V1,
  opacityMultiplier: { ...ROLLER_PRICING_V1.opacityMultiplier, blackout: 1.3 },
  optionSurcharges: {
    ...ROLLER_PRICING_V1.optionSurcharges,
    control: { ...ROLLER_PRICING_V1.optionSurcharges.control, motorized: 95 },
  },
};

export const DRAPERY_PRICING_V1: DraperyPricingConfig = {
  kind: "drapery-formula",
  currency: "USD",
  fabricBoltWidthCm: 140,
  headerAllowanceCm: 25,
  hemAllowanceCm: 15,
  fabricPricePerMeter: { standard: 14, premium: 22, designer: 34 },
  opacitySurchargePerMeter: {
    sheer: 0,
    "semi-sheer": 1,
    opaque: 2.5,
    blackout: 4,
  },
  makingPerWidth: {
    "pinch-pleat": 28,
    "euro-pleat": 30,
    "goblet-pleat": 34,
    ripplefold: 32,
    grommet: 22,
    "rod-pocket": 18,
    "back-tab": 20,
  },
  liningPerMeter: { unlined: 0, privacy: 6, blackout: 9.5, interlined: 12 },
  controlFlat: { "baton-draw": 0, "cord-draw": 18, "motorized-somfy": 280 },
  fullnessFactor: { "2x": 2.0, "2.5x": 2.5, "3x": 3.0 },
  minCharge: 89,
};
