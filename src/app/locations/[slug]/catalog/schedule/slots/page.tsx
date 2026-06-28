import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import {
  countUpcomingAvailabilities,
  listUpcomingAvailabilities,
  type UpcomingSlot,
} from "@/lib/data/availability";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

const DAYS = 14;

function capacityLabel(s: UpcomingSlot): string {
  if (s.itemCapacityMode === "fixed") {
    const cap = s.capacityOverride ?? s.scheduleCapacityPerSlot;
    return cap != null ? `cap ${cap}` : "cap —";
  }
  return "resource-based";
}

export default async function SlotsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const tz = loc.timezone ?? "utc";
  const [slots, total] = await Promise.all([
    listUpcomingAvailabilities(loc.id, DAYS),
    countUpcomingAvailabilities(loc.id),
  ]);

  // Group by the slot's local calendar day.
  const groups = new Map<string, { label: string; slots: UpcomingSlot[] }>();
  for (const s of slots) {
    const dt = DateTime.fromJSDate(s.startsAt).setZone(tz);
    const key = dt.toFormat("yyyy-LL-dd");
    if (!groups.has(key))
      groups.set(key, { label: dt.toFormat("cccc, LLL d"), slots: [] });
    groups.get(key)!.slots.push(s);
  }

  const base = `/locations/${slug}/catalog/schedule`;

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <Link href={base} className="hover:text-zinc-700 dark:hover:text-zinc-300">
          Schedule
        </Link>
        <span>/</span>
        <span>Generated slots</span>
      </div>

      <header className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Generated slots
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Next {DAYS} days · {total} upcoming slot{total === 1 ? "" : "s"} total
          {loc.timezone ? (
            <>
              {" "}
              · times in <span className="font-mono">{loc.timezone}</span>
            </>
          ) : (
            " · no timezone set on this location"
          )}
          .
        </p>
      </header>

      {slots.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            No upcoming slots
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
            Create an active schedule (with a timezone set on the location) to
            generate bookable slots.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.values()].map((g) => (
            <div key={g.label}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {g.label}
              </h3>
              <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {g.slots.map((s) => {
                  const start = DateTime.fromJSDate(s.startsAt)
                    .setZone(tz)
                    .toFormat("h:mm a");
                  const end = DateTime.fromJSDate(s.endsAt)
                    .setZone(tz)
                    .toFormat("h:mm a");
                  return (
                    <li
                      key={s.id}
                      className="flex items-center gap-4 px-4 py-2.5"
                    >
                      <span className="w-36 shrink-0 font-mono text-sm text-zinc-700 dark:text-zinc-300">
                        {start}–{end}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
                        {s.itemName}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {capacityLabel(s)} · {s.onlineBookingStatus}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
