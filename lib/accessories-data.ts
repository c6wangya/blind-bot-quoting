// A-OK accessories catalog — imported from "2025 Business pricing.pdf" (49 line items).
// 3-level browse: Brand (A-OK) → Category → Model. Prices are USD, verbatim from the PDF.
//
// Category names follow A-OK's own taxonomy as shown on their distributor site
// (aplusmanufactory.com). Motor categories are orderable (add-to-quote, like full
// products); control/power categories are reference-only for now (easy to flip on later).
//
// ⚠️ The category each MOTOR is filed under is best-effort from the PDF description and
// is marked for review with Damon against the website's motor catalog. Models present on
// the website but NOT in the PDF (AM70, AC139-01, AC407-01) are deferred to that review.

export interface AccessoryCategory {
  id: string;
  name: string;
  /** motors are orderable; controls/power are reference-only for now */
  orderable: boolean;
  blurb: string;
  /** representative photo (from the PDF) shown for models in this category until per-model photos land */
  image: string;
}

export interface AccessoryModel {
  id: string;
  categoryId: string;
  sku: string; // PDF ITEM#
  name: string;
  description: string;
  price: number | null; // USD; null = "included" / no standalone price
  imageUrl?: string;
}

export const ACCESSORY_BRAND = { id: "a-ok", name: "A-OK", tagline: "Window covering motors & controls" };

const IMG = "/catalog/accessories/aok";
export const ACCESSORY_CATEGORIES: AccessoryCategory[] = [
  { id: "roller-shades-motors", name: "Roller Shades Motors", orderable: true, blurb: "Tubular motors for roller, zebra & roller blinds", image: `${IMG}/roller-shades-motors.jpg` },
  { id: "curtain-motors", name: "Curtain Motors", orderable: true, blurb: "Drapery / curtain track motors", image: `${IMG}/curtain-motors.jpg` },
  { id: "venetian-motors", name: "Venetian Motors", orderable: true, blurb: "Tilt & venetian / shutter motors", image: `${IMG}/venetian-motors.jpg` },
  { id: "roller-shutter-motors", name: "Roller Shutter Motors", orderable: true, blurb: "High-torque roller shutter & awning motors", image: `${IMG}/roller-shutter-motors.jpg` },
  { id: "remote-control", name: "Remote Control", orderable: false, blurb: "Hand-held & wall-type emitters", image: `${IMG}/remote-control.jpg` },
  { id: "receivers", name: "Receivers", orderable: false, blurb: "Radio receivers", image: `${IMG}/receivers.jpg` },
  { id: "power-accessories", name: "Power & Accessories", orderable: false, blurb: "Solar panels, batteries, chargers", image: `${IMG}/power-accessories.jpg` },
  { id: "smart-central-control", name: "Smart Central Control", orderable: false, blurb: "Smart-home hub", image: `${IMG}/smart-central-control.jpg` },
];

const slug = (sku: string) =>
  "aok-" + sku.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const m = (categoryId: string, sku: string, name: string, description: string, price: number | null): AccessoryModel => ({
  id: slug(sku),
  categoryId,
  sku,
  name,
  description,
  price,
});

export const ACCESSORY_MODELS: AccessoryModel[] = [
  // ---------------- Roller Shades Motors (tubular) ----------------
  m("roller-shades-motors", "AM15-03/35-ES-E", "AM15 Tube Motor", "0.3 N·m, 1 inch tube motor with built-in battery", 31),
  m("roller-shades-motors", "AM25-1/30-ES", "AM25 Tube Motor", "1 N·m, 12V, 1.5 inch tube motor (no built-in battery)", 45),
  m("roller-shades-motors", "AM25-1/30-ES-E", "AM25 Tube Motor · Battery", "1 N·m, 1.5 inch tube motor with built-in battery", 53),
  m("roller-shades-motors", "AM25-1/30-ES-EB", "AM25 Tube Motor · Bluetooth", "1 N·m, 1.5 inch Bluetooth tube motor, built-in battery, Type-C charging", 55),
  m("roller-shades-motors", "AM25-1/30-ES-EZ", "AM25 Tube Motor · Zigbee", "1 N·m, 1.5 inch Zigbee tube motor, built-in battery, connects to Amazon directly", 63),
  m("roller-shades-motors", "AM28-1.8/25-ES-E", "AM28 Tube Motor · Battery", "1.8 N·m, 38mm tube motor with built-in battery", 58),
  m("roller-shades-motors", "AM28-1.8/25-ES-EQ", "AM28 Tube Motor · Ultra Quiet", "1.8 N·m, 38mm ultra-quiet tube motor, built-in 7.4V battery", 75),
  m("roller-shades-motors", "AM35-6/14-ES-E", "AM35 Tube Motor · Battery", "6 N·m, 2 inch tube motor with built-in battery", 85),
  m("roller-shades-motors", "AM35-6/28-E", "AM35 Tube Motor · Receiver", "6 N·m, built-in receiver motor", 48),
  m("roller-shades-motors", "AM35-6/28-MEL", "AM35 Electronic Limit Motor", "6 N·m, electronic limit motor", 55),
  m("roller-shades-motors", "AM35-6/28-MEL-ZG", "AM35 Zero-Gap Electronic Limit", "6 N·m, zero-gap electronic limit motor", 58),
  m("roller-shades-motors", "AM45-6/28-QMEL", "AM45 Ultra-Quiet Electronic Limit", "6 N·m, ultra-quiet electronic limit motor", 84),

  // ---------------- Curtain Motors ----------------
  m("curtain-motors", "AM68-2/80-EM-P", "AM68 Curtain Motor", "2 N·m, AC120V curtain motor", 55),
  m("curtain-motors", "AM50-1.2/80-ES-E", "AM50 Curtain Motor", "1.2 N·m, 5V battery curtain motor", 75),

  // ---------------- Venetian Motors (tilt / shutter) ----------------
  m("venetian-motors", "AM24", "AM24 Venetian Motor", "7.4V DC, 25mm headrail venetian blinds motor, single shaft", 42),
  m("venetian-motors", "AM24-TDBU", "AM24 TDBU Kit", "Top-down/bottom-up kit: 2× AM24-06/34-ES-I motors + 1× battery pack AC704-01", 90),
  m("venetian-motors", "AM54-06/10-ES", "AM54 Tilting Motor", "AM54 tilting motor (3-0805001)", 55),
  m("venetian-motors", "AM20", "AM20 Shutter Motor", "Plantation shutter motor, RF + Bluetooth, 5VDC, with 900mAh lithium battery [category: review]", 73),

  // ---------------- Roller Shutter Motors (high torque) ----------------
  m("roller-shutter-motors", "AM45-20/17-E", "AM45 Receiver Motor", "20 N·m, built-in receiver motor", 71),
  m("roller-shutter-motors", "AM45-20/12-ER-ES", "AM45 DC Electronic Limit", "20 N·m, DC electronic limit motor", 85),
  m("roller-shutter-motors", "AM45-50/12-MEL-TX", "AM45 Ultra-Quiet Electronic Limit", "50 N·m, ultra-quiet electronic limit motor, fast-installation head", 76),
  m("roller-shutter-motors", "AM45-50/12-ME", "AM45 Manual Override Motor", "50 N·m, manual override built-in receiver motor", 77),
  m("roller-shutter-motors", "AM60-100/12-ME", "AM60 Manual Override Motor", "100 N·m, manual override built-in receiver motor", 110),

  // ---------------- Remote Control (emitters) — reference only ----------------
  m("remote-control", "AC136-16", "AC136 TDBU Remote", "16-channel top-down/bottom-up motor remote", 30),
  m("remote-control", "AC114-01B", "AC114 Emitter · 1ch", "Single channel emitter", 6),
  m("remote-control", "AC114-02B", "AC114 Emitter · 2ch", "Dual channel emitter", 7),
  m("remote-control", "AC114-16B", "AC114 Emitter · 16ch", "16 channel emitter", 9),
  m("remote-control", "AC123-01D", "AC123 Emitter · 1ch", "Single channel emitter", 7.5),
  m("remote-control", "AC123-02D", "AC123 Emitter · 2ch", "Dual channel emitter", 8.5),
  m("remote-control", "AC123-06D", "AC123 Emitter · 6ch", "6 channel emitter", 12.5),
  m("remote-control", "AC123-16D", "AC123 Emitter · 16ch", "16 channel emitter", 13.5),
  m("remote-control", "AC133-01", "AC133 Wall Emitter · 1ch", "Single channel square wall-type emitter", 13),
  m("remote-control", "AC133-02", "AC133 Wall Emitter · 2ch", "Dual channel square wall-type emitter", 15),
  m("remote-control", "AC133-05", "AC133 Wall Emitter · 5ch", "5 channel square wall-type emitter", 18),
  m("remote-control", "AC135-01", "AC135 Wall Emitter · 1ch", "Single channel wall-type emitter", 13),
  m("remote-control", "AC135-02", "AC135 Wall Emitter · 2ch", "Dual channel wall-type emitter", 15),
  m("remote-control", "AC135-06", "AC135 Wall Emitter · 6ch", "6 channel wall-type emitter", 18),
  m("remote-control", "AC140-01", "AC140 Touch Screen · 1ch", "Touch screen 1 channel emitter", 13),
  m("remote-control", "AC140-02", "AC140 Touch Screen · 2ch", "Touch screen 2 channel emitter", 15),
  m("remote-control", "AC140-06", "AC140 Touch Screen · 6ch", "Touch screen 6 channel emitter", 17),
  m("remote-control", "AC140-16", "AC140 Touch Screen · 16ch", "Touch screen 16 channel emitter", 21),

  // ---------------- Receivers — reference only ----------------
  m("receivers", "AC128-01", "AC128 Radio Receiver", "American-style radio receiver, 12V DC to 12V DC, 433.92MHz", 12),
  m("receivers", "AC508-01", "AC508 Radio Receiver", "American-style radio receiver, 120V AC to 120V AC, 433.92MHz", 12),

  // ---------------- Power & Accessories — reference only ----------------
  m("power-accessories", "AC601-01", "AC601 Solar Panel", "Solar panel", 40),
  m("power-accessories", "AC604-01", "AC604 Solar Panel", "Solar panel compatible with AM45-20/12-ER-ES", 40),
  m("power-accessories", "CHARGER-7.4DC", "Charger · 7.4V DC", "Charger for 7.4V DC motor", 9),
  m("power-accessories", "CHARGER-5V-38MM", "Charger · 5V (38mm)", "5V direct current charger for 38mm tube motor", 5),
  m("power-accessories", "BATTERY-WAND", "Rechargeable Battery Wand", "Battery wand for AM45-20/12-ES", 30),
  m("power-accessories", "AC711-01", "AC711 Battery Pack", "Battery pack for AM54 tilting motor (3-0649001)", 29),
  m("power-accessories", "EXT-BATTERY-AM24", "External Battery (AM24)", "External battery for AM24 DC motor — included with AM24", null),

  // ---------------- Smart Central Control — reference only ----------------
  m("smart-central-control", "AC520-01", "AC520 Smart Home Hub", "Smart home central control", 40),
];

export const ACCESSORY_PRICING_VERSION = "aok-2025";

export function getAccessoryCategories(): AccessoryCategory[] {
  return ACCESSORY_CATEGORIES;
}

export function getAccessoryCategory(id: string): AccessoryCategory | undefined {
  return ACCESSORY_CATEGORIES.find((c) => c.id === id);
}

export function getAccessoryModels(categoryId?: string): AccessoryModel[] {
  return categoryId ? ACCESSORY_MODELS.filter((m) => m.categoryId === categoryId) : ACCESSORY_MODELS;
}

export function getAccessoryModel(id: string): AccessoryModel | undefined {
  return ACCESSORY_MODELS.find((m) => m.id === id);
}

/** The category image stands in as a model's thumbnail until per-model photos land. */
export function accessoryImage(model: AccessoryModel): string {
  return model.imageUrl ?? getAccessoryCategory(model.categoryId)?.image ?? "";
}
