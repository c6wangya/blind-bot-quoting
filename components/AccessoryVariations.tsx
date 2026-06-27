import type { AccessoryConfig } from "@/lib/types";
import { usd } from "@/lib/format";

/**
 * Read-only breakdown of an accessory line's sub-parts (variation items such as Crown/Drive) with
 * quantity + price. Shown on the converted-quote and order pages, where the draft editor (with its
 * qty steppers + live stock) isn't available. Variation qty is snapshotted per motor unit, so the
 * displayed count is `motorQty × per-motor qty` — the real number of that sub-part on the order.
 */
export function AccessoryVariations({ cfg, motorQty }: { cfg: AccessoryConfig; motorQty: number }) {
  if (cfg.variations?.length) {
    return (
      <div className="mt-1.5 space-y-1">
        {cfg.variations.map((v) => (
          <div
            key={v.itemId}
            className="flex items-baseline justify-between gap-3 text-[11.5px] text-ink-soft"
          >
            <span className="min-w-0">
              {v.variationName}: <span className="font-medium">{v.itemLabel}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {motorQty * (v.qty ?? 1)} × {usd(v.price)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (cfg.crownDriver?.mode === "crown-driver") {
    return (
      <div className="mt-1 text-[11.5px] text-ink-soft">
        Crown: <span className="font-medium">{cfg.crownDriver.crownLabel}</span> · Drive:{" "}
        <span className="font-medium">{cfg.crownDriver.driverLabel}</span>
      </div>
    );
  }
  return null;
}
