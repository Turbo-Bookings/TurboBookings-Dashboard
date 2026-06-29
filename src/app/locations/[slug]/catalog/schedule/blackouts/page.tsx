import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { BlackoutForm } from "@/components/BlackoutForm";
import { DeleteBlackoutButton } from "@/components/DeleteBlackoutButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { listBlackouts } from "@/lib/data/blackouts";
import { listItemsForSelect } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function BlackoutsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const [blackouts, items] = await Promise.all([
    listBlackouts(loc.id),
    listItemsForSelect(loc.id),
  ]);
  const base = `/locations/${slug}/catalog/schedule`;

  return (
    <section>
      <div className="mb-2">
        <Link href={base} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          <ChevronLeft className="h-3.5 w-3.5" /> Schedule
        </Link>
      </div>
      <PageHeader
        title="Blackout dates"
        description="Suppress tour slots on specific dates (holidays, closures). Removing a blackout restores those slots."
      />

      <BlackoutForm slug={slug} items={items.map((i) => ({ id: i.id, name: i.name }))} />

      <h2 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Active blackouts
      </h2>
      {blackouts.length === 0 ? (
        <p className="text-sm text-zinc-500">No blackout dates set.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {blackouts.map((b) => (
            <li key={b.id} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {b.startDate}
                  {b.endDate ? ` – ${b.endDate}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {b.itemName ?? "All tours"}
                  {b.reason ? ` · ${b.reason}` : ""}
                </p>
              </div>
              <DeleteBlackoutButton slug={slug} id={b.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
