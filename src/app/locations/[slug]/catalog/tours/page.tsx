import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteItem } from "@/lib/actions/items";
import { getLocationBySlug } from "@/lib/data/locations";
import { listItemsWithPricingSummary } from "@/lib/data/items";

type Props = {
  params: Promise<{ slug: string }>;
};

function formatPriceRange(
  min: number | null,
  max: number | null,
): string {
  if (min == null || max == null) return "No pricing yet";
  const lo = (min / 100).toFixed(2);
  const hi = (max / 100).toFixed(2);
  return min === max ? `$${lo}` : `$${lo} – $${hi}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}hr`;
  return `${h}hr ${m}min`;
}

export default async function ToursPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const rows = await listItemsWithPricingSummary(loc.id);

  return (
    <section>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Tours
          </h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            The items this location sells through the booking system. Each tour
            has its own pricing matrix mapping customer types to prices.
          </p>
        </div>
        <Link
          href={`/locations/${slug}/catalog/tours/new`}
          data-tour="catalog-new-tour"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          + New tour
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            No tours yet
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
            Add Customer Types and Resources first, then come back here to
            create tours that bind them together.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((item) => {
            const hidden = !item.listingVisible;
            const notBookable = !item.bookableOnline;
            return (
              <li
                key={item.id}
                className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center ${
                  hidden && notBookable ? "opacity-60" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {item.name}
                    </p>
                    {hidden && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        Unlisted
                      </span>
                    )}
                    {notBookable && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        Not bookable online
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {formatDuration(item.defaultDurationMinutes)}
                    {" · "}
                    {item.customerTypeCount > 0
                      ? `${item.customerTypeCount} customer type${item.customerTypeCount === 1 ? "" : "s"} · `
                      : ""}
                    <span className="font-mono">
                      {formatPriceRange(item.minPriceCents, item.maxPriceCents)}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/locations/${slug}/catalog/tours/${item.id}/pricing`}
                    className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Pricing
                  </Link>
                  <Link
                    href={`/locations/${slug}/catalog/tours/${item.id}/resources`}
                    className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Resources
                  </Link>
                  <Link
                    href={`/locations/${slug}/catalog/tours/${item.id}`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    Edit
                  </Link>
                  <form
                    action={async () => {
                      "use server";
                      await deleteItem(slug, item.id);
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
