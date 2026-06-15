import type { ItemConfig, OpacityId, Product, ProductLine } from "./types";

/**
 * Bridge for designs carried in from the upstream visualization tool.
 *
 * Skeleton scope (see docs/superpowers/specs/2026-06-14-result-to-configurator-import-skeleton-design.md):
 * the inbound configuration is shown to the user as a reference only — it is NOT
 * auto-applied to the form yet, because the upstream option vocabulary does not line
 * up with this catalog. `mapImportedConfig` is the seam where that real mapping will
 * live later; today it is intentionally a no-op.
 */

/** Upstream selections, a flat string dictionary (e.g. { color, translucency, ... }). */
export type ImportedConfig = Record<string, string>;

export interface ImportPayload {
  /** Result image URL, shown as a reference. */
  img: string;
  /** Upstream selections, shown as a reference (not auto-applied). */
  cfg: ImportedConfig;
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse the inbound import params. Returns null when there is nothing usable to import
 * (so the page renders exactly as a normal direct visit). Defensive against arbitrary
 * input: `img` must be an http(s) URL, and only string-valued cfg entries are kept.
 */
export function parseImportPayload(
  img: string | undefined,
  cfg: string | undefined
): ImportPayload | null {
  if (!img || !isHttpUrl(img)) return null;

  const parsed: ImportedConfig = {};
  if (cfg) {
    try {
      const obj = JSON.parse(cfg) as unknown;
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof v === "string" && v.length > 0) parsed[k] = v;
        }
      }
    } catch {
      // malformed cfg — fall through and show the image with no reference list
    }
  }
  return { img, cfg: parsed };
}

/** Normalize a blind-bot translucency term → quote opacity id (or undefined). */
function mapOpacity(translucency: string | undefined, validOpacities: OpacityId[]): OpacityId | undefined {
  const t = (translucency ?? "").toLowerCase();
  let candidate: OpacityId | undefined;
  if (t.includes("blackout")) candidate = "blackout";
  else if (t.includes("room") || t.includes("darken")) candidate = "room-darkening";
  else if (t.includes("filter") || t.includes("privacy")) candidate = "light-filtering";
  else if (t.includes("sheer") || t.includes("solar") || t.includes("screen")) candidate = "sheer";
  // only apply if this product can actually be produced in that opacity
  return candidate && validOpacities.includes(candidate) ? candidate : undefined;
}

function mapMount(mountType: string | undefined): string | undefined {
  const m = (mountType ?? "").toLowerCase();
  if (m.includes("inside")) return "inside";
  if (m.includes("outside")) return "outside";
  return undefined;
}

function mapControl(control: string | undefined): string | undefined {
  const c = (control ?? "").toLowerCase();
  if (c.includes("motor")) return "motorized";
  if (c.includes("cord") || c.includes("chain") || c.includes("manual")) return "chain-plastic";
  return undefined;
}

/**
 * Case-insensitive lookup across the aliases an upstream field might use. blind-bot
 * template variations send names like "Transparency" / "Installation" / "Control_type"
 * / "Color" — not the RenderOptions field keys — so we try several spellings.
 */
function pick(cfg: ImportedConfig, ...keys: string[]): string | undefined {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg)) lower[k.toLowerCase()] = v;
  for (const key of keys) {
    const v = lower[key.toLowerCase()];
    if (v) return v;
  }
  return undefined;
}

/**
 * Map upstream (blind-bot) selections onto this product's config — best-effort,
 * always respecting the product's constraints. Only fields that map cleanly are
 * returned; everything else falls back to the configurator's defaults.
 *
 * Grounded in blind-bot's real vocabulary:
 *  - translucency ("Sheer"/"Solar", "Light Filtering"/"Privacy", "Room Darkening",
 *    "Blackout") → opacityId, gated on validOpacities.
 *  - mountType ("Inside/Outside Mount") → mount; control ("Motorized" / cord / chain)
 *    → control — each applied only if that option exists on this product line.
 *  - color: exact case-insensitive name match against this product's palette (rare).
 *  - dimensions: blind-bot has none → left for the user.
 */
export function mapImportedConfig(
  cfg: ImportedConfig,
  product: Product,
  line: ProductLine
): Partial<ItemConfig> {
  const out: Partial<ItemConfig> = {};

  const opacityId = mapOpacity(pick(cfg, "transparency", "translucency", "opacity"), product.validOpacities);
  if (opacityId) out.opacityId = opacityId;

  const colorName = pick(cfg, "color");
  const color = product.colors.find((c) => c.name.toLowerCase() === (colorName ?? "").toLowerCase());
  if (color) out.colorId = color.id;

  const options: Record<string, string> = {};
  const setIfValid = (groupKey: string, value: string | undefined) => {
    if (!value) return;
    const group = line.optionGroups.find((g) => g.key === groupKey);
    if (group?.options.some((o) => o.id === value)) options[groupKey] = value;
  };
  setIfValid("mount", mapMount(pick(cfg, "installation", "mounttype", "mount")));
  setIfValid("control", mapControl(pick(cfg, "control_type", "control")));
  if (Object.keys(options).length > 0) out.options = options;

  return out;
}
