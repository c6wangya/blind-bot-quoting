import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { getWindowProduct, getWindowTemplate, updateWindowProduct } from "@/lib/db";
import type { FieldPolicy } from "@/lib/window/types";

/** Product detail + its pinned template (the editor needs both to render policies over fields). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const product = await getWindowProduct(id);
    if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const template = await getWindowTemplate(product.templateId);
    return NextResponse.json({ product, template });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * PATCH — REST merge semantics: only provided fields change; fieldPolicies merge by key
 * (removedPolicyKeys deletes). Returns the same full DTO as GET so the editor refreshes
 * from the response without a follow-up read.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const body = (await req.json()) as {
      name?: string;
      sku?: string | null;
      description?: string | null;
      status?: "draft" | "active" | "archived";
      imageUrl?: string | null;
      sortOrder?: number;
      fieldPolicies?: Record<string, FieldPolicy>;
      removedPolicyKeys?: string[];
    };
    if (body.status && !["draft", "active", "archived"].includes(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }
    if (body.fieldPolicies) {
      for (const [key, p] of Object.entries(body.fieldPolicies)) {
        if (typeof p !== "object" || p === null || typeof p.isOffered !== "boolean" || !("controlKind" in p)) {
          return NextResponse.json({ error: `invalid policy for "${key}"` }, { status: 400 });
        }
      }
    }
    const product = await updateWindowProduct(id, body);
    const template = await getWindowTemplate(product.templateId);
    return NextResponse.json({ product, template });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "Product not found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
