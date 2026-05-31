import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteResource } from "@/lib/actions/resources";
import { getLocationBySlug } from "@/lib/data/locations";
import { listResources } from "@/lib/data/resources";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function ResourcesPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const rows = await listResources(loc.id);

  return (
    <section>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Resources
          </h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Capacity pools — the physical things this location has. Items
            declare what they consume per (item × customer type) on the Tours
            page.
          </p>
        </div>
        <Link
          href={`/locations/${slug}/catalog/resources/new`}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          + New resource
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            No resources yet
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
            Add at least one before configuring a tour. Typical entries: ATVs,
            UTVs, Guides, Spectator Seats.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((r) => {
            const effective = r.maxConcurrentUses - r.outOfServiceCount;
            return (
              <li key={r.id} className="flex items-center gap-4 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {r.name}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    <span className="font-mono">{effective}</span> available now
                    <span className="text-zinc-400">
                      {" "}
                      · {r.maxConcurrentUses} total
                      {r.outOfServiceCount > 0
                        ? ` · ${r.outOfServiceCount} out of service`
                        : ""}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/locations/${slug}/catalog/resources/${r.id}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Edit
                  </Link>
                  <form
                    action={async () => {
                      "use server";
                      await deleteResource(slug, r.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="text-sm font-medium text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
