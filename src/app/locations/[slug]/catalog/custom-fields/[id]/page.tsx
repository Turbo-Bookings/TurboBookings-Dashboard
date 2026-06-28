import { notFound } from "next/navigation";
import { AttachFieldControl } from "@/components/AttachFieldControl";
import { CustomFieldForm } from "@/components/CustomFieldForm";
import { DeleteCustomFieldButton } from "@/components/DeleteCustomFieldButton";
import { updateCustomField } from "@/lib/actions/customFields";
import { getCustomField } from "@/lib/data/customFields";
import { listItemsForSelect } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = { params: Promise<{ slug: string; id: string }> };

export default async function EditCustomFieldPage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const data = await getCustomField(id, loc.id);
  if (!data) notFound();
  const { field, attachedItemIds } = data;
  const items = await listItemsForSelect(loc.id);
  const action = updateCustomField.bind(null, slug, id);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Edit {field.label}
        </h2>
        <DeleteCustomFieldButton slug={slug} id={id} />
      </div>
      <CustomFieldForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/custom-fields`}
        initial={{
          kind: field.kind,
          label: field.label,
          helpText: field.helpText ?? "",
          required: field.required,
          priceDollars: field.pricePerUnitCents ? String(field.pricePerUnitCents / 100) : "",
          optionsText: field.dropdownOptions?.map((o) => o.label).join("\n") ?? "",
        }}
        submitLabel="Save changes"
      />
      <AttachFieldControl
        slug={slug}
        fieldId={id}
        items={items.map((i) => ({ id: i.id, name: i.name }))}
        attached={attachedItemIds}
      />
    </section>
  );
}
