import type { Condition } from "./types";

// Evaluator for the render3d visibleWhen/enabledWhen condition subset used by template fields
// and sections. Mirrors @blindbot/render3d semantics: leaf conditions test one field; composites
// are not/anyOf/allOf. A leaf may combine equals/in/truthy — all present tests must pass.
export function evalCondition(cond: Condition | undefined, config: Record<string, unknown>): boolean {
  if (!cond) return true;
  if ("not" in cond) return !evalCondition(cond.not, config);
  if ("anyOf" in cond) return cond.anyOf.some((c) => evalCondition(c, config));
  if ("allOf" in cond) return cond.allOf.every((c) => evalCondition(c, config));
  const v = config[cond.field];
  if (cond.equals !== undefined && v !== cond.equals) return false;
  if (cond.in !== undefined && !cond.in.includes(v as never)) return false;
  if (cond.truthy !== undefined && Boolean(v) !== cond.truthy) return false;
  return true;
}
