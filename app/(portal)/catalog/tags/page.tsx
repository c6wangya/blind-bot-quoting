import { PageHeader } from "@/components/ui";
import { TagAdmin } from "@/components/TagAdmin";
import { ModelTagEditor, type TaggableModel } from "@/components/ModelTagEditor";
import { requireAdminPage } from "@/lib/auth/user";
import { getAttributes, getModelTagMap } from "@/lib/db";
import { getAccessoryCategories, getAccessoryModels } from "@/lib/accessories-data";

export default async function TagsPage() {
  await requireAdminPage("/catalog/tags");

  const [attributes, tagMap] = await Promise.all([getAttributes(), getModelTagMap()]);

  // v1 tagging surface: orderable motor models.
  const models: TaggableModel[] = getAccessoryCategories()
    .filter((c) => c.orderable)
    .flatMap((c) =>
      getAccessoryModels(c.id).map((m) => ({ id: m.id, name: m.name, sku: m.sku, categoryName: c.name }))
    );

  return (
    <div>
      <PageHeader
        eyebrow="Catalog · Admin"
        title="Accessory Tags"
        description="Define filter attributes (e.g. Power, Compatible products) and their values, then tag each motor. Retailers filter the accessory catalog by these. Tags are for discovery only — they don't change pricing."
      />

      <div className="space-y-10">
        <section>
          <h2 className="rise mb-3 text-lg font-semibold tracking-tight text-ink">Attributes</h2>
          <TagAdmin attributes={attributes} />
        </section>

        <section>
          <h2 className="mb-1 text-lg font-semibold tracking-tight text-ink">Tag motors</h2>
          <p className="mb-3 text-[13px] text-muted">
            {models.length} orderable motor models. Single-value attributes pick one; multi-value attributes allow
            several.
          </p>
          <ModelTagEditor models={models} attributes={attributes} tagMap={tagMap} />
        </section>
      </div>
    </div>
  );
}
