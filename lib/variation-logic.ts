// Pure (React-free) helpers for picking accessory variations (sub-products): which types are
// available for a model, how they split into paired groups vs independents, and which items must
// be greyed out because they're incompatible with another active pick. Shared by the inline
// 4th-column panel (and reusable by the legacy modal).

import type { VariationRestriction, VariationType } from "@/lib/db";

/** Trim each variation type to the items actually assigned to this model; drop empty types. */
export function availableTypes(variations: VariationType[], availableItemIds: string[]): VariationType[] {
  const ok = new Set(availableItemIds);
  return variations
    .map((t) => ({ ...t, items: t.items.filter((i) => ok.has(i.id)) }))
    .filter((t) => t.items.length > 0);
}

/** Split available types into paired groups (Crown + Drive, added together) and independents. */
export function splitGroups(avail: VariationType[]): { pairGroups: VariationType[][]; independents: VariationType[] } {
  const m = new Map<string, VariationType[]>();
  for (const t of avail) if (t.pairGroup) (m.get(t.pairGroup) ?? m.set(t.pairGroup, []).get(t.pairGroup)!).push(t);
  return { pairGroups: [...m.values()], independents: avail.filter((t) => !t.pairGroup) };
}

/** item id → set of item ids it can't be combined with (symmetric). */
export function buildBlocked(restrictions: VariationRestriction[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
  for (const r of restrictions) { add(r.itemLo, r.itemHi); add(r.itemHi, r.itemLo); }
  return m;
}

/** item id → its display name, across all available types. */
export function buildItemNames(avail: VariationType[]): Record<string, string> {
  const n: Record<string, string> = {};
  for (const t of avail) for (const i of t.items) n[i.id] = i.name;
  return n;
}

/**
 * Items of `type` that conflict with another type's currently-active pick → greyed out, with the
 * conflicting option's name for the tooltip. `activePick(t)` returns the chosen item id of `t`
 * only when it's actually in play (independent, or its paired group is toggled on).
 */
export function disabledFor(
  type: VariationType,
  avail: VariationType[],
  activePick: (t: VariationType) => string,
  blocked: Map<string, Set<string>>,
  itemName: Record<string, string>
): { ids: Set<string>; reason: Record<string, string> } {
  const ids = new Set<string>();
  const reason: Record<string, string> = {};
  for (const other of avail) {
    if (other.id === type.id) continue;
    const chosen = activePick(other);
    if (!chosen) continue;
    const conflicts = blocked.get(chosen);
    if (!conflicts) continue;
    for (const it of type.items)
      if (conflicts.has(it.id)) { ids.add(it.id); reason[it.id] = itemName[chosen] ?? "your current selection"; }
  }
  return { ids, reason };
}
