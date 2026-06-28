import Link from "next/link";
import { notFound } from "next/navigation";
import { ScheduleForm } from "@/components/ScheduleForm";
import { updateSchedule } from "@/lib/actions/schedules";
import {
  getResourceSummariesByItem,
  listItemsForSelect,
} from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";
import { getScheduleById } from "@/lib/data/schedules";
import { parseWeekly } from "@/lib/rrule/weekly";

type Props = {
  params: Promise<{ slug: string; id: string }>;
};

export default async function EditSchedulePage({ params }: Props) {
  const { slug, id } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const [schedule, items, resourceSummaries] = await Promise.all([
    getScheduleById(id, loc.id),
    listItemsForSelect(loc.id),
    getResourceSummariesByItem(loc.id),
  ]);
  if (!schedule) notFound();

  const parts = parseWeekly(schedule.rruleText);
  const action = updateSchedule.bind(null, slug, id);
  const base = `/locations/${slug}/catalog/schedule`;

  return (
    <section>
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-500">
        <Link
          href={base}
          className="hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          Schedule
        </Link>
        <span>/</span>
        <span>Edit</span>
      </div>
      <h2 className="mb-6 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        Edit schedule
      </h2>
      <ScheduleForm
        action={action}
        slug={slug}
        items={items}
        timezone={loc.timezone}
        resourceSummaries={resourceSummaries}
        initialValues={{
          itemId: schedule.itemId,
          weekdays: parts?.weekdays ?? [],
          startTimesLocal: schedule.startTimesLocal,
          durationMinutes: String(schedule.durationMinutes),
          capacityPerSlot:
            schedule.capacityPerSlot != null
              ? String(schedule.capacityPerSlot)
              : "",
          defaultOnlineBookingStatus: schedule.defaultOnlineBookingStatus,
          seasonStart: parts?.seasonStart ?? "",
          seasonEnd: parts?.seasonEnd ?? "",
          materializeDaysAhead: String(schedule.materializeDaysAhead),
          active: schedule.active,
        }}
        cancelHref={base}
        submitLabel="Save"
      />
    </section>
  );
}
