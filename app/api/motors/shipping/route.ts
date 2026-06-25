import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { setMotorShippingBatch, setWaiveExpedite, setWaiveShipping } from "@/lib/db";

/**
 * Admin only. Either:
 *   { rates: [{ modelId, mode, ground, expedite }] } → batch-set per-motor mode + rates ("Save all")
 *   { retailerId, kind: "ground"|"expedite", waive } → toggle a retailer's shipping waiver
 *       (waiving expedite requires ground already waived — enforced in setWaiveExpedite)
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = await req.json();
    const { rates, retailerId, kind, waive } = body ?? {};

    if (Array.isArray(rates)) {
      const clean: { modelId: string; mode: "fob" | "ground"; ground: number; expedite: number }[] = [];
      for (const r of rates) {
        if (!r || typeof r.modelId !== "string" || !r.modelId) {
          return NextResponse.json({ error: "each rate needs a modelId" }, { status: 400 });
        }
        if (r.mode !== "fob" && r.mode !== "ground") {
          return NextResponse.json({ error: "mode must be 'fob' or 'ground'" }, { status: 400 });
        }
        for (const k of ["ground", "expedite"] as const) {
          if (typeof r[k] !== "number" || !Number.isFinite(r[k]) || r[k] < 0) {
            return NextResponse.json({ error: `${k} must be a non-negative number` }, { status: 400 });
          }
        }
        clean.push({ modelId: r.modelId, mode: r.mode, ground: r.ground, expedite: r.expedite });
      }
      await setMotorShippingBatch(clean);
      return NextResponse.json({ ok: true });
    }

    if (typeof retailerId === "string" && retailerId && typeof waive === "boolean") {
      if (kind === "ground") {
        await setWaiveShipping(retailerId, waive);
        return NextResponse.json({ ok: true });
      }
      if (kind === "expedite") {
        await setWaiveExpedite(retailerId, waive); // throws if ground isn't waived first
        return NextResponse.json({ ok: true });
      }
      return NextResponse.json({ error: "kind must be 'ground' or 'expedite'" }, { status: 400 });
    }

    return NextResponse.json({ error: "Provide { rates } or { retailerId, kind, waive }" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
