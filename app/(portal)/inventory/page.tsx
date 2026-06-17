import { PageHeader } from "@/components/ui";
import { MotorInventoryEditor, type InventoryRow } from "@/components/MotorInventoryEditor";
import { requireAdminPage } from "@/lib/auth/user";
import { getInventoryMap } from "@/lib/db";
import { getAccessoryCategories, getAccessoryModels } from "@/lib/accessories-data";

export default async function MotorInventoryPage() {
  await requireAdminPage("/inventory");
  const inv = await getInventoryMap();

  const rows: InventoryRow[] = getAccessoryCategories()
    .filter((c) => c.orderable)
    .flatMap((c) =>
      getAccessoryModels(c.id).map((m) => ({
        modelId: m.id,
        name: m.name,
        sku: m.sku,
        category: c.name,
        stock: m.id in inv ? inv[m.id] : null,
      }))
    );

  return (
    <div>
      <PageHeader
        eyebrow="Admin · Inventory"
        title="Motor Inventory"
        description="Stock per motor model. Stock is deducted when a retailer submits a pre-order; the catalog blocks adding beyond what's left. Leave blank to keep a model untracked (unlimited)."
      />
      <MotorInventoryEditor rows={rows} />
    </div>
  );
}
