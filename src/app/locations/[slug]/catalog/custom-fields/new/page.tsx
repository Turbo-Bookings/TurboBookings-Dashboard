import { notFound } from "next/navigation";
import { CustomFieldForm } from "@/components/CustomFieldForm";
import { createCustomField } from "@/lib/actions/customFields";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = { params: Promise<{ slug: string }> };

export default async function NewCustomFieldPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const action = createCustomField.bind(null, slug);

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New custom field
      </h2>
      <CustomFieldForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/custom-fields`}
        submitLabel="Create field"
      />
      <p className="mt-4 max-w-lg text-xs text-zinc-500">
        After creating, open the field to choose which tours it shows on.
      </p>
    </section>
  );
}
