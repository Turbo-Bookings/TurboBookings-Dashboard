import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerTypeForm } from "@/components/CustomerTypeForm";
import { updateCustomerType } from "@/lib/actions/customerTypes";
import { getCustomerTypeById } from "@/lib/data/customerTypes";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string; id: string }>;
};

export default async function EditCustomerTypePage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const ct = await getCustomerTypeById(id, loc.id);
  if (!ct) notFound();

  const action = updateCustomerType.bind(null, slug, id);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <Link
          href={`/locations/${slug}/catalog/customer-types`}
          className="hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Customer types
        </Link>
        <span>/</span>
        <span className="truncate">{ct.singular}</span>
      </div>
      <h2 className="mb-6 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Edit customer type
      </h2>
      <CustomerTypeForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/customer-types`}
        initialValues={{
          singular: ct.singular,
          plural: ct.plural,
          sku: ct.sku ?? "",
          note: ct.note ?? "",
          minAge: ct.minAge?.toString() ?? "",
          personsPerUnit: ct.personsPerUnit > 1 ? String(ct.personsPerUnit) : "",
          ticketColor: ct.ticketColor ?? "",
          excludePricingModifiers: ct.excludePricingModifiers,
          archived: ct.archived,
        }}
        showArchivedField
        submitLabel="Save"
      />
    </section>
  );
}
