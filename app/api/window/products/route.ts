import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import { createWindowProduct, getDefaultOrgId, listWindowProducts } from "@/lib/db";

/** List the org's window products (drafts included — this is the admin editor surface). */
export async function GET() {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const orgId = await getDefaultOrgId();
    return NextResponse.json(await listWindowProducts(orgId, { includeArchived: true }));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Create a product from a template: { templateId, name, sku?, description? }.
 *  Policies initialize to "everything offered at template defaults"; returns the full DTO. */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = (await req.json()) as { templateId?: number; name?: string; sku?: string; description?: string };
    if (!Number.isInteger(body.templateId)) {
      return NextResponse.json({ error: "templateId is required" }, { status: 400 });
    }
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const orgId = await getDefaultOrgId();
    const product = await createWindowProduct({
      orgId,
      templateId: body.templateId!,
      name,
      sku: body.sku?.trim() || undefined,
      description: body.description?.trim() || undefined,
    });
    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "Template not found" ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
