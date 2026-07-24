import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import {
  addPriceGrid,
  addSizeConstraint,
  addSurchargeRule,
  getDefaultOrgId,
  getWindowProduct,
  listPriceGroups,
  listSizeConstraints,
  listSurchargeRules,
  loadWindowPricingData,
  removeSizeConstraint,
  removeSurchargeRule,
  setPriceGroupMaps,
  upsertPriceGroup,
} from "@/lib/db";
import type { RuleMatcher, SurchargeKind } from "@/lib/window/types";

/** Everything the pricing tab renders for one product: groups, maps, effective grids,
 *  surcharges (product + org-wide), size constraints. Admin only. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const product = await getWindowProduct(id);
    if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const orgId = await getDefaultOrgId();
    const [data, groups, surcharges, constraints] = await Promise.all([
      loadWindowPricingData(orgId, id, null),
      listPriceGroups(orgId),
      listSurchargeRules(orgId, id),
      listSizeConstraints(orgId, id),
    ]);
    return NextResponse.json({
      priceGroups: groups,
      priceGroupMaps: data.priceGroupMaps,
      priceGrids: data.priceGrids,
      surchargeRules: surcharges,
      sizeConstraints: constraints,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Pricing mutations, one action per call (the pricing tab saves incrementally):
 *   { action: "upsertGroup",     group: { key, label? } }
 *   { action: "setMaps",         fieldKey, entries: [{ valueToken, priceGroupId }] }
 *   { action: "addGrid",         grid: { priceGroupId, widthBreaks, heightBreaks, cells, note? } }
 *   { action: "addSurcharge",    rule: { label, matcher, kind, amount, orgWide? } }
 *   { action: "removeSurcharge", id }
 *   { action: "addConstraint",   constraint: { matcher, dimension, minValue?, maxValue?, message?, orgWide? } }
 *   { action: "removeConstraint", id }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const productId = Number((await ctx.params).id);
  if (!Number.isInteger(productId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const product = await getWindowProduct(productId);
    if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const orgId = await getDefaultOrgId();
    const body = await req.json();

    switch (body.action) {
      case "upsertGroup": {
        const key = String(body.group?.key ?? "").trim();
        if (!key) return NextResponse.json({ error: "group.key is required" }, { status: 400 });
        return NextResponse.json(await upsertPriceGroup(orgId, { key, label: body.group?.label }));
      }
      case "setMaps": {
        const fieldKey = String(body.fieldKey ?? "").trim();
        if (!fieldKey) return NextResponse.json({ error: "fieldKey is required" }, { status: 400 });
        const entries = Array.isArray(body.entries) ? body.entries : [];
        for (const e of entries) {
          if (typeof e?.valueToken !== "string" || !Number.isInteger(e?.priceGroupId)) {
            return NextResponse.json({ error: "each entry needs valueToken + priceGroupId" }, { status: 400 });
          }
        }
        await setPriceGroupMaps(orgId, productId, fieldKey, entries);
        return NextResponse.json({ ok: true });
      }
      case "addGrid": {
        const g = body.grid ?? {};
        const widths = Array.isArray(g.widthBreaks) ? g.widthBreaks.map(Number) : [];
        const heights = Array.isArray(g.heightBreaks) ? g.heightBreaks.map(Number) : [];
        const cells = Array.isArray(g.cells) ? g.cells : [];
        if (!Number.isInteger(g.priceGroupId)) {
          return NextResponse.json({ error: "grid.priceGroupId is required" }, { status: 400 });
        }
        if (!widths.length || !heights.length || widths.some(Number.isNaN) || heights.some(Number.isNaN)) {
          return NextResponse.json({ error: "widthBreaks/heightBreaks must be numeric" }, { status: 400 });
        }
        const ascending = (a: number[]) => a.every((v, i) => i === 0 || v > a[i - 1]);
        if (!ascending(widths) || !ascending(heights)) {
          return NextResponse.json({ error: "breaks must be strictly ascending" }, { status: 400 });
        }
        if (cells.length !== heights.length || cells.some((r: unknown[]) => !Array.isArray(r) || r.length !== widths.length)) {
          return NextResponse.json({ error: "cells must be heightBreaks × widthBreaks" }, { status: 400 });
        }
        for (const row of cells as unknown[][]) {
          for (const c of row) {
            if (c !== null && (typeof c !== "number" || !Number.isFinite(c) || c < 0)) {
              return NextResponse.json({ error: "cells must be non-negative numbers or null" }, { status: 400 });
            }
          }
        }
        const grid = await addPriceGrid(orgId, {
          priceGroupId: g.priceGroupId,
          widthBreaks: widths,
          heightBreaks: heights,
          cells,
          note: typeof g.note === "string" ? g.note : undefined,
        });
        return NextResponse.json(grid, { status: 201 });
      }
      case "addSurcharge": {
        const r = body.rule ?? {};
        const kinds: SurchargeKind[] = ["flat", "per_unit", "percent", "width_band", "per_linear_ft"];
        if (!r.label || !kinds.includes(r.kind) || typeof r.matcher?.fieldKey !== "string") {
          return NextResponse.json({ error: "rule needs label, kind, matcher.fieldKey" }, { status: 400 });
        }
        const rule = await addSurchargeRule(orgId, {
          productId: r.orgWide ? null : productId,
          label: String(r.label),
          matcher: r.matcher as RuleMatcher,
          kind: r.kind,
          amount: r.amount ?? {},
        });
        return NextResponse.json(rule, { status: 201 });
      }
      case "removeSurcharge": {
        if (!Number.isInteger(body.id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
        await removeSurchargeRule(body.id);
        return NextResponse.json({ ok: true });
      }
      case "addConstraint": {
        const c = body.constraint ?? {};
        if (typeof c.matcher?.fieldKey !== "string" || !["width", "height", "area_sqft"].includes(c.dimension)) {
          return NextResponse.json({ error: "constraint needs matcher.fieldKey + dimension" }, { status: 400 });
        }
        const constraint = await addSizeConstraint(orgId, {
          productId: c.orgWide ? null : productId,
          matcher: c.matcher as RuleMatcher,
          dimension: c.dimension,
          minValue: typeof c.minValue === "number" ? c.minValue : null,
          maxValue: typeof c.maxValue === "number" ? c.maxValue : null,
          message: typeof c.message === "string" ? c.message : null,
        });
        return NextResponse.json(constraint, { status: 201 });
      }
      case "removeConstraint": {
        if (!Number.isInteger(body.id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
        await removeSizeConstraint(body.id);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
