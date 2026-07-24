import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/api";
import {
  getDefaultOrgId,
  getWindowProduct,
  getWindowTemplate,
  loadWindowPricingData,
} from "@/lib/db";
import { priceWindowLine } from "@/lib/window/price";
import { WindowPricingError } from "@/lib/window/types";
import type { WindowLineConfig } from "@/lib/window/types";

/**
 * Validate + price one window line. Body: WindowLineConfig (+ dealerAccountId? for admin
 * previewing a specific dealer's net price; otherwise admin previews at MSRP, factor 1).
 * 422 carries structured issues [{fieldKey?, code, message}] for inline display.
 *
 * v1 admin-gated like the rest of the window surface; when dealers get access this switches
 * to resolving THEIR dealer_account_id from the profile (never from the body).
 */
export async function POST(req: Request) {
  const gate = await requireAdmin();
  if (gate instanceof NextResponse) return gate;
  try {
    const body = (await req.json()) as WindowLineConfig & { dealerAccountId?: number };
    if (!Number.isInteger(body.productId)) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }
    const widthIn = Number(body.widthIn);
    const heightIn = Number(body.heightIn);
    if (!Number.isFinite(widthIn) || !Number.isFinite(heightIn)) {
      return NextResponse.json({ error: "widthIn and heightIn are required" }, { status: 400 });
    }
    const product = await getWindowProduct(body.productId);
    if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
    const template = await getWindowTemplate(product.templateId);
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    const orgId = await getDefaultOrgId();
    const dealerAccountId = Number.isInteger(body.dealerAccountId) ? body.dealerAccountId! : null;
    const pricing = await loadWindowPricingData(orgId, product.id, dealerAccountId);

    const computation = priceWindowLine({
      template,
      product,
      config: {
        productId: product.id,
        templateRevision: product.templateRevision,
        room: typeof body.room === "string" ? body.room : undefined,
        widthIn,
        heightIn,
        selections: body.selections ?? {},
        parentItemId: Number.isInteger(body.parentItemId) ? body.parentItemId : undefined,
        specialInstructions:
          typeof body.specialInstructions === "string" ? body.specialInstructions : undefined,
      },
      pricing,
      lineKey: template.lineKey,
      factorOverride: dealerAccountId == null ? 1 : undefined, // admin preview = MSRP
    });
    return NextResponse.json(computation);
  } catch (err) {
    if (err instanceof WindowPricingError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
