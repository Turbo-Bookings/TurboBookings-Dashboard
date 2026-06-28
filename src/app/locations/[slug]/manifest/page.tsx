import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { Manifest } from "@/components/Manifest";
import { manifestForDate } from "@/lib/data/bookings";
import { listItemsForSelect } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
};

export default async function ManifestPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { date } = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const tz = loc.timezone ?? "America/Chicago";
  const dateKey =
    date && DAY_RE.test(date) ? date : DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
  const day = DateTime.fromISO(dateKey, { zone: tz });

  const [slots, items] = await Promise.all([
    manifestForDate(loc.id, dateKey, tz),
    listItemsForSelect(loc.id),
  ]);

  return (
    <Manifest
      slug={slug}
      tz={tz}
      dateKey={dateKey}
      prevKey={day.minus({ days: 1 }).toFormat("yyyy-LL-dd")}
      nextKey={day.plus({ days: 1 }).toFormat("yyyy-LL-dd")}
      todayKey={DateTime.now().setZone(tz).toFormat("yyyy-LL-dd")}
      dayLabel={day.toFormat("cccc, LLL d")}
      items={items.map((i) => ({ id: i.id, name: i.name }))}
      slots={slots}
    />
  );
}
