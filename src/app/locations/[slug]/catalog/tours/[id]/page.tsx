import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemForm } from "@/components/ItemForm";
import { ItemPhotoManager } from "@/components/ItemPhotoManager";
import { updateItem } from "@/lib/actions/items";
import { getItemById, getItemCapacityCeiling } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string; id: string }>;
};

export default async function EditTourPage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const item = await getItemById(id, loc.id);
  if (!item) notFound();

  // Only used to warn that a threshold at or above the tour's ceiling fires on every slot.
  const capacityCeiling = await getItemCapacityCeiling(id, loc.id);
  const action = updateItem.bind(null, slug, id);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <Link
          href={`/locations/${slug}/catalog/tours`}
          className="hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Tours
        </Link>
        <span>/</span>
        <span className="truncate">{item.name}</span>
      </div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Edit tour
        </h2>
        <div className="flex items-center gap-4">
          <Link
            href={`/locations/${slug}/catalog/tours/${id}/pricing`}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Pricing matrix →
          </Link>
          <Link
            href={`/locations/${slug}/catalog/tours/${id}/resources`}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Resources →
          </Link>
        </div>
      </div>
      <ItemForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/tours`}
        initialValues={{
          name: item.name,
          descriptionMd: item.descriptionMd ?? "",
          highlights: item.highlights,
          included: item.included,
          whatToBring: item.whatToBring,
          minAge: item.minAge != null ? String(item.minAge) : "",
          languages: item.languages,
          groupSizeLabel: item.groupSizeLabel ?? "",
          faqs: item.faqs,
          cancellationNotesMd: item.cancellationNotesMd ?? "",
          defaultDurationMinutes: item.defaultDurationMinutes.toString(),
          capacityMode: item.capacityMode,
          lowStockThreshold: String(item.lowStockThreshold),
          bookableOnline: item.bookableOnline,
          listingVisible: item.listingVisible,
        }}
        capacityCeiling={capacityCeiling}
        submitLabel="Save"
      />

      <div className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <ItemPhotoManager slug={slug} itemId={id} photos={item.photoUrls} />
      </div>
    </section>
  );
}
