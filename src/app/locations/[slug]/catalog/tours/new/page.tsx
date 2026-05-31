import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemForm } from "@/components/ItemForm";
import { createItem } from "@/lib/actions/items";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function NewTourPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const action = createItem.bind(null, slug);

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
        <span>New</span>
      </div>
      <h2 className="mb-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New tour
      </h2>
      <p className="mb-6 max-w-2xl text-sm text-zinc-500">
        After creating, you&apos;ll land on the pricing matrix to add the
        customer types this tour offers and set their prices.
      </p>
      <ItemForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/tours`}
        submitLabel="Create"
      />
    </section>
  );
}
