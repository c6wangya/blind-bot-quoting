import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { createMotorOption, deleteMotorOption, updateMotorOption, type CrownDriverKind } from "@/lib/db";

const kindOf = (k: unknown): CrownDriverKind | null => (k === "crown" || k === "driver" ? k : null);

/** Create a Crown/Driver version. Body: { kind: "crown"|"driver", label, priceDelta }. Admin only. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const { kind, label, priceDelta } = await req.json();
    const k = kindOf(kind);
    if (!k) return NextResponse.json({ error: "kind must be crown or driver" }, { status: 400 });
    if (typeof label !== "string" || !label.trim()) return NextResponse.json({ error: "Label required" }, { status: 400 });
    const pd = Number(priceDelta);
    if (!Number.isFinite(pd) || pd < 0) return NextResponse.json({ error: "priceDelta must be ≥ 0" }, { status: 400 });
    await createMotorOption(k, label, pd);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Update a version. Body: { kind, id, label?, priceDelta? }. Admin only. */
export async function PATCH(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const { kind, id, label, priceDelta } = await req.json();
    const k = kindOf(kind);
    if (!k || typeof id !== "string" || !id) return NextResponse.json({ error: "kind + id required" }, { status: 400 });
    const patch: { label?: string; priceDelta?: number } = {};
    if (typeof label === "string") patch.label = label;
    if (priceDelta !== undefined) {
      const pd = Number(priceDelta);
      if (!Number.isFinite(pd) || pd < 0) return NextResponse.json({ error: "priceDelta must be ≥ 0" }, { status: 400 });
      patch.priceDelta = pd;
    }
    await updateMotorOption(k, id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** Delete a version. Body: { kind, id }. Admin only. */
export async function DELETE(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const { kind, id } = await req.json();
    const k = kindOf(kind);
    if (!k || typeof id !== "string" || !id) return NextResponse.json({ error: "kind + id required" }, { status: 400 });
    await deleteMotorOption(k, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
