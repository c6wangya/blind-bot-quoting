import type { SupabaseClient } from "@supabase/supabase-js";
import { admin } from "@/lib/supabase/admin";
import type {
  FieldPolicy,
  TemplateField,
  WindowProduct,
  WindowTemplate,
} from "@/lib/window/types";

// L1 templates + L2 merchant products. Follows the lib/db conventions: snake→camel column
// aliases, every helper takes an optional SupabaseClient (default service role; retailer-facing
// call sites pass userClient() so RLS applies).

const TEMPLATE_COLS =
  "id, orgId:org_id, lineKey:line_key, label, revision, status, source, fields, sections, dimensions, rules, createdAt:created_at, updatedAt:updated_at";
const PRODUCT_COLS =
  "id, orgId:org_id, templateId:template_id, templateRevision:template_revision, name, sku, description, status, fieldPolicies:field_policies, imageUrl:image_url, sortOrder:sort_order, createdAt:created_at, updatedAt:updated_at";

export async function listWindowTemplates(client: SupabaseClient = admin()): Promise<WindowTemplate[]> {
  const { data, error } = await client
    .from("product_templates")
    .select(TEMPLATE_COLS)
    .eq("status", "published")
    .order("line_key")
    .order("revision", { ascending: false });
  if (error) throw error;
  // Latest published revision per line.
  const seen = new Set<string>();
  const out: WindowTemplate[] = [];
  for (const t of (data ?? []) as unknown as WindowTemplate[]) {
    if (seen.has(t.lineKey)) continue;
    seen.add(t.lineKey);
    out.push(t);
  }
  return out;
}

export async function getWindowTemplate(
  id: number,
  client: SupabaseClient = admin()
): Promise<WindowTemplate | null> {
  const { data, error } = await client.from("product_templates").select(TEMPLATE_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as WindowTemplate) ?? null;
}

export async function getWindowTemplateByLine(
  lineKey: string,
  revision: number,
  client: SupabaseClient = admin()
): Promise<WindowTemplate | null> {
  const { data, error } = await client
    .from("product_templates")
    .select(TEMPLATE_COLS)
    .eq("line_key", lineKey)
    .eq("revision", revision)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as WindowTemplate) ?? null;
}

export async function listWindowProducts(
  orgId: number,
  opts: { includeArchived?: boolean } = {},
  client: SupabaseClient = admin()
): Promise<WindowProduct[]> {
  let q = client.from("catalog_products").select(PRODUCT_COLS).eq("org_id", orgId);
  if (!opts.includeArchived) q = q.neq("status", "archived");
  const { data, error } = await q.order("sort_order").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as WindowProduct[];
}

export async function getWindowProduct(
  id: number,
  client: SupabaseClient = admin()
): Promise<WindowProduct | null> {
  const { data, error } = await client.from("catalog_products").select(PRODUCT_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as WindowProduct) ?? null;
}

/** Seed policies from a template: everything offered at template defaults (blind-bot 3D-seed parity). */
export function defaultPoliciesFromTemplate(fields: TemplateField[]): Record<string, FieldPolicy> {
  const policies: Record<string, FieldPolicy> = {};
  for (const f of fields) {
    switch (f.control.kind) {
      case "select":
        policies[f.key] = {
          isOffered: true,
          controlKind: "select",
          allowedValues: f.control.options.map((o) => o.value),
          defaultValue: f.defaultValue as string | number,
        };
        break;
      case "toggle":
        policies[f.key] = { isOffered: true, controlKind: "toggle", defaultValue: Boolean(f.defaultValue) };
        break;
      case "slider":
        policies[f.key] = {
          isOffered: true,
          controlKind: "slider",
          range: { min: f.control.min, max: f.control.max, step: f.control.step },
          defaultValue: Number(f.defaultValue),
        };
        break;
      case "color":
        policies[f.key] = {
          isOffered: true,
          controlKind: "color",
          allowedColors: (f.control.options ?? []).map((o) => ({
            optionId: String(o.value),
            label: o.label,
            value: String(o.hex ?? o.value).toLowerCase(),
          })),
          defaultValue: String(f.defaultValue ?? "").toLowerCase(),
        };
        break;
      case "image":
        policies[f.key] = { isOffered: true, controlKind: "image", allowedPatterns: [], defaultPattern: null };
        break;
      case "text":
        policies[f.key] = { isOffered: true, controlKind: "text", defaultValue: String(f.defaultValue ?? "") };
        break;
    }
  }
  return policies;
}

export async function createWindowProduct(
  args: {
    orgId: number;
    templateId: number;
    name: string;
    sku?: string;
    description?: string;
  },
  client: SupabaseClient = admin()
): Promise<WindowProduct> {
  const template = await getWindowTemplate(args.templateId, client);
  if (!template) throw new Error("Template not found");
  const { data, error } = await client
    .from("catalog_products")
    .insert({
      org_id: args.orgId,
      template_id: template.id,
      template_revision: template.revision,
      name: args.name,
      sku: args.sku ?? null,
      description: args.description ?? null,
      field_policies: defaultPoliciesFromTemplate(template.fields),
    })
    .select(PRODUCT_COLS)
    .single();
  if (error) throw error;
  return data as unknown as WindowProduct;
}

/**
 * PATCH semantics (canonical API style): merge only the provided field policies by key —
 * never replace the whole document. Basic fields update only when present in the patch.
 */
export async function updateWindowProduct(
  id: number,
  patch: {
    name?: string;
    sku?: string | null;
    description?: string | null;
    status?: "draft" | "active" | "archived";
    imageUrl?: string | null;
    sortOrder?: number;
    fieldPolicies?: Record<string, FieldPolicy>;
    removedPolicyKeys?: string[];
  },
  client: SupabaseClient = admin()
): Promise<WindowProduct> {
  const existing = await getWindowProduct(id, client);
  if (!existing) throw new Error("Product not found");

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.sku !== undefined) row.sku = patch.sku;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.imageUrl !== undefined) row.image_url = patch.imageUrl;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  if (patch.fieldPolicies || patch.removedPolicyKeys) {
    const merged = { ...existing.fieldPolicies, ...(patch.fieldPolicies ?? {}) };
    for (const k of patch.removedPolicyKeys ?? []) delete merged[k];
    row.field_policies = merged;
  }

  const { data, error } = await client
    .from("catalog_products")
    .update(row)
    .eq("id", id)
    .select(PRODUCT_COLS)
    .single();
  if (error) throw error;
  return data as unknown as WindowProduct;
}
