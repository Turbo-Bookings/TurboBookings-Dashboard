import Link from "next/link";
import { notFound } from "next/navigation";
import { setCustomerTypeArchived } from "@/lib/actions/customerTypes";
import { getLocationBySlug } from "@/lib/data/locations";
import { listCustomerTypes } from "@/lib/data/customerTypes";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function CustomerTypesPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const types = await listCustomerTypes(loc.id);

  return (
    <section>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Customer types
          </h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Ticket types this location sells — e.g. Single Rider ATV, Double
            Rider, Spectator. Items pull their pricing matrix from this pool.
          </p>
        </div>
        <Link
          href={`/locations/${slug}/catalog/customer-types/new`}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          + New customer type
        </Link>
      </header>

      {types.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            No customer types yet
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
            Add at least one before configuring a tour. The simplest setup is a
            single &quot;Rider&quot; type; multi-tier pricing (Single, Double,
            Spectator) is supported via additional rows.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {types.map((t) => (
            <li
              key={t.id}
              className={`flex items-center gap-4 px-4 py-3 ${
                t.archived ? "opacity-60" : ""
              }`}
            >
              <div
                aria-hidden
                className="h-6 w-1.5 shrink-0 rounded-full"
                style={{ background: t.ticketColor ?? "#d4d4d8" }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t.singular}
                  </p>
                  {t.archived && (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                      Archived
                    </span>
                  )}
                  {t.excludePricingModifiers && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      No modifiers
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  Plural: {t.plural}
                  {t.sku ? ` · SKU: ${t.sku}` : ""}
                  {t.minAge != null ? ` · Min age: ${t.minAge}` : ""}
                  {t.personsPerUnit > 1 ? ` · ${t.personsPerUnit} riders per unit` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/locations/${slug}/catalog/customer-types/${t.id}`}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Edit
                </Link>
                <form
                  action={async () => {
                    "use server";
                    await setCustomerTypeArchived(slug, t.id, !t.archived);
                  }}
                >
                  <button
                    type="submit"
                    className="text-sm font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                  >
                    {t.archived ? "Unarchive" : "Archive"}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
