import Link from "next/link";
import { notFound } from "next/navigation";
import { ScheduleForm } from "@/components/ScheduleForm";
import { createSchedule } from "@/lib/actions/schedules";
import {
  getResourceSummariesByItem,
  listItemsForSelect,
} from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

function todayYmd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export default async function NewSchedulePage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const [items, resourceSummaries] = await Promise.all([
    listItemsForSelect(loc.id),
    getResourceSummariesByItem(loc.id),
  ]);
  const action = createSchedule.bind(null, slug);
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
        <span>New</span>
      </div>
      <h2 className="mb-6 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        New schedule
      </h2>
      <ScheduleForm
        action={action}
        slug={slug}
        items={items}
        timezone={loc.timezone}
        resourceSummaries={resourceSummaries}
        initialValues={{
          itemId: items[0]?.id ?? "",
          weekdays: [],
          startTimesLocal: [],
          durationMinutes: String(items[0]?.defaultDurationMinutes ?? 60),
          capacityPerSlot: "",
          defaultOnlineBookingStatus: "auto",
          seasonStart: todayYmd(),
          seasonEnd: "",
          materializeDaysAhead: "90",
          active: true,
        }}
        cancelHref={base}
        submitLabel="Create"
      />
    </section>
  );
}
