import Link from "next/link";
import { notFound } from "next/navigation";
import { ResourceForm } from "@/components/ResourceForm";
import { createResource } from "@/lib/actions/resources";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function NewResourcePage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const action = createResource.bind(null, slug);

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
        <span>New</span>
      </div>
      <h2 className="mb-6 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New resource
      </h2>
      <ResourceForm
        action={action}
        cancelHref={`/locations/${slug}/catalog/resources`}
        submitLabel="Create"
      />
    </section>
  );
}
