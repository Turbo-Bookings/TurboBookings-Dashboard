import Link from "next/link";
import { notFound } from "next/navigation";
import { ResourceForm } from "@/components/ResourceForm";
import { updateResource } from "@/lib/actions/resources";
import { getLocationBySlug } from "@/lib/data/locations";
import { getResourceById } from "@/lib/data/resources";

type Props = {
  params: Promise<{ slug: string; id: string }>;
};

export default async function EditResourcePage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const r = await getResourceById(id, loc.id);
  if (!r) notFound();

  const action = updateResource.bind(null, slug, id);

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <Link
          href={`/locations/${slug}/catalog/resources`}
          className="hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Resources
        </Link>
        <span>/</span>
        <span className="truncate">{r.name}</span>
      </div>
      <h2 className="mb-6 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Edit resource
      </h2>
      <ResourceForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/resources`}
        initialValues={{
          name: r.name,
          maxConcurrentUses: r.maxConcurrentUses.toString(),
          outOfServiceCount: r.outOfServiceCount.toString(),
        }}
        submitLabel="Save"
      />
    </section>
  );
}
