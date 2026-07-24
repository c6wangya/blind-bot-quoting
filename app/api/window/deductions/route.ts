import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import {
  addDeductionRow,
  getDefaultOrgId,
  listDeductionRows,
  removeDeductionRow,
  reviseDeductionRow,
} from "@/lib/db";
import type { DeductionComponent, PartRule } from "@/lib/window/production";
import type { RuleMatcher } from "@/lib/window/types";

/** Live deduction rows (optionally per line). Admin only. */
export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const lineKey = new URL(req.url).searchParams.get("lineKey") ?? undefined;
    return NextResponse.json(await listDeductionRows(await getDefaultOrgId(), lineKey));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function validComponents(components: unknown): components is Record<string, DeductionComponent> {
  if (typeof components !== "object" || components === null) return false;
  for (const c of Object.values(components as Record<string, DeductionComponent>)) {
    if (typeof c?.offset !== "number" || !Number.isFinite(c.offset)) return false;
    if (c.base !== "width" && c.base !== "height") return false;
    if (c.multiplier !== undefined && (!Number.isFinite(c.multiplier) || c.multiplier <= 0)) return false;
    if (typeof c.label !== "string" || !c.label) return false;
  }
  return true;
}

function validParts(parts: unknown): parts is PartRule[] {
  if (parts === undefined) return true;
  if (!Array.isArray(parts)) return false;
  for (const p of parts as PartRule[]) {
    if (typeof p?.key !== "string" || !p.key || typeof p?.label !== "string") return false;
    const r = p.qtyRule;
    if (r?.kind === "per_unit") {
      if (!Number.isFinite(r.value) || r.value < 0) return false;
    } else if (r?.kind === "width_band") {
      if (!Array.isArray(r.breaks) || !Array.isArray(r.values) || r.breaks.length !== r.values.length) return false;
    } else return false;
  }
  return true;
}

/**
 * { action: "add",    row: { lineKey, label, matcher: RuleMatcher[], components, parts?, sortOrder?, note? } }
 * { action: "revise", id, components?, parts?, label?, note? }   — effective-dated close + reinsert
 * { action: "remove", id }                                       — effective-dated close
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json();
    const orgId = await getDefaultOrgId();

    switch (body.action) {
      case "add": {
        const r = body.row ?? {};
        if (typeof r.lineKey !== "string" || !r.lineKey || typeof r.label !== "string" || !r.label) {
          return NextResponse.json({ error: "row needs lineKey + label" }, { status: 400 });
        }
        const matcher = Array.isArray(r.matcher) ? (r.matcher as RuleMatcher[]) : [];
        if (matcher.some((m) => typeof m?.fieldKey !== "string" || !m.fieldKey)) {
          return NextResponse.json({ error: "each matcher needs a fieldKey" }, { status: 400 });
        }
        if (!validComponents(r.components ?? {})) {
          return NextResponse.json({ error: "invalid components" }, { status: 400 });
        }
        if (!validParts(r.parts)) return NextResponse.json({ error: "invalid parts" }, { status: 400 });
        const row = await addDeductionRow(orgId, {
          lineKey: r.lineKey,
          label: r.label,
          matcher,
          components: r.components ?? {},
          parts: r.parts ?? [],
          sortOrder: Number.isInteger(r.sortOrder) ? r.sortOrder : 0,
          note: typeof r.note === "string" ? r.note : null,
        });
        return NextResponse.json(row, { status: 201 });
      }
      case "revise": {
        if (!Number.isInteger(body.id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
        if (body.components !== undefined && !validComponents(body.components)) {
          return NextResponse.json({ error: "invalid components" }, { status: 400 });
        }
        if (!validParts(body.parts)) return NextResponse.json({ error: "invalid parts" }, { status: 400 });
        const row = await reviseDeductionRow(orgId, body.id, {
          components: body.components,
          parts: body.parts,
          label: typeof body.label === "string" ? body.label : undefined,
          note: typeof body.note === "string" ? body.note : undefined,
        });
        return NextResponse.json(row);
      }
      case "remove": {
        if (!Number.isInteger(body.id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
        await removeDeductionRow(orgId, body.id);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Not found" ? 404 : 500 });
  }
}
