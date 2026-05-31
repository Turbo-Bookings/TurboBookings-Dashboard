import Link from "next/link";
import { notFound } from "next/navigation";
import { ResourceRequirementsEditor } from "@/components/ResourceRequirementsEditor";
import { saveItemResourceRequirements } from "@/lib/actions/items";
import { getItemById, getItemResourceMatrix } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string; id: string }>;
};

export default async function ResourceRequirementsPage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const item = await getItemById(id, loc.id);
  if (!item) notFound();

  const matrix = await getItemResourceMatrix(id);
  const saveAction = saveItemResourceRequirements.bind(null, slug, id);

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
        <Link
          href={`/locations/${slug}/catalog/tours/${id}`}
          className="truncate hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {item.name}
        </Link>
        <span>/</span>
        <span>Resources</span>
      </div>
      <header className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Resource requirements
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            For each customer type on this tour, how many of each resource one
            booking consumes — e.g. a Single Rider takes 1 ATV. A slot stays
            bookable until any required resource is exhausted. Leave a cell blank
            for no requirement.
          </p>
        </div>
        <Link
          href={`/locations/${slug}/catalog/tours/${id}/pricing`}
          className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Pricing matrix
        </Link>
      </header>

      <ResourceRequirementsEditor
        customerTypes={matrix.customerTypes}
        resources={matrix.resources}
        initialCells={matrix.cells}
        saveAction={saveAction}
      />
    </section>
  );
}
