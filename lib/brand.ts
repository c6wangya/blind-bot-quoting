// Single source of truth for the white-label brand shown to retailers.
// Overridable per-deploy via NEXT_PUBLIC_* env vars; these are only the defaults.
// NEXT_PUBLIC_ so the same values resolve in both client and server contexts.
const name = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Loom & Shade";

export const BRAND = {
  name,
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE ?? "Trade Portal",
  monogram: process.env.NEXT_PUBLIC_BRAND_MONOGRAM ?? "LS",
  /** Filename-safe form, e.g. "LoomAndShade". */
  slug: name.replace(/&/g, "And").replace(/[^A-Za-z0-9]+/g, ""),
};
