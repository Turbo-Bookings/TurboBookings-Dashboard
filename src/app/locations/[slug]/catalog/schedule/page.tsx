import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteSchedule } from "@/lib/actions/schedules";
import { listItemsForSelect } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";
import {
  listSchedulesForLocation,
  type ScheduleWithItem,
} from "@/lib/data/schedules";
import { parseWeekly, WEEKDAYS } from "@/lib/rrule/weekly";

type Props = {
  params: Promise<{ slug: string }>;
};

const SHORT_BY_CODE: Record<string, string> = Object.fromEntries(
  WEEKDAYS.map((d) => [d.code, d.short]),
);
const DAY_ORDER = WEEKDAYS.map((d) => d.code);

function summarizeDays(rruleText: string): string {
  const parts = parseWeekly(rruleText);
  if (!parts || parts.weekdays.length === 0) return "—";
  return parts.weekdays
    .slice()
    .sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
    .map((c) => SHORT_BY_CODE[c] ?? c)
    .join(", ");
}

function seasonLabel(rruleText: string): string {
  const parts = parseWeekly(rruleText);
  if (!parts) return "";
  return parts.seasonEnd
    ? `${parts.seasonStart} → ${parts.seasonEnd}`
    : `from ${parts.seasonStart}`;
}

function summarizeTimes(times: string[]): string {
  if (!times || times.length === 0) return "—";
  const shown = times.slice(0, 3).join(", ");
  return times.length > 3 ? `${shown} +${times.length - 3}` : shown;
}

export default async function SchedulePage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const [schedules, items] = await Promise.all([
    listSchedulesForLocation(loc.id),
    listItemsForSelect(loc.id),
  ]);

  // Group by tour for readability.
  const byItem = new Map<string, ScheduleWithItem[]>();
  for (const s of schedules) {
    const list = byItem.get(s.itemName) ?? [];
    list.push(s);
    byItem.set(s.itemName, list);
  }

  const base = `/locations/${slug}/catalog/schedule`;

  return (
    <section>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Availability Schedules
          </h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            Recurring weekly patterns per tour — which days, start time, and
            capacity. The booking system generates concrete bookable slots from
            these.
            {loc.timezone ? (
              <>
                {" "}
                Times are local to{" "}
                <span className="font-mono">{loc.timezone}</span>.
              </>
            ) : (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {" "}
                No timezone set for this location — set one before generating
                slots.
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href={`${base}/calendar`}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Calendar →
          </Link>
          <Link
            href={`${base}/slots`}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Generated slots →
          </Link>
          {items.length > 0 && (
            <Link
              href={`${base}/new`}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              + New schedule
            </Link>
          )}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            Add a tour first
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
            Schedules attach to a tour. Create one on the Tours tab, then come
            back to set its weekly availability.
          </p>
        </div>
      ) : schedules.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            No schedules yet
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-xs text-zinc-500">
            Add a weekly recurring pattern so the booking flow has slots to sell.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...byItem.entries()].map(([itemName, rows]) => (
            <div key={itemName}>
              <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {itemName}
              </h3>
              <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {rows.map((s) => (
                  <li key={s.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {summarizeDays(s.rruleText)}{" "}
                        <span className="font-mono text-zinc-500">
                          @ {summarizeTimes(s.startTimesLocal)}
                        </span>
                        {!s.active && (
                          <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800">
                            Paused
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {s.durationMinutes} min ·{" "}
                        {s.itemCapacityMode === "fixed"
                          ? `cap ${s.capacityPerSlot ?? "—"}`
                          : "resource-based"}{" "}
                        · {s.defaultOnlineBookingStatus} ·{" "}
                        {seasonLabel(s.rruleText)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`${base}/${s.id}`}
                        className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        Edit
                      </Link>
                      <form
                        action={async () => {
                          "use server";
                          await deleteSchedule(slug, s.id);
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
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
