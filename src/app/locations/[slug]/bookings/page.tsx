import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight, Lock, Plus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { ViewToggle } from "@/app/locations/[slug]/bookings/list/page";
import { gridForDate, type GridSlot } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";
import { TONE_DOT, itemColor } from "@/lib/ui/itemColor";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
};

export default async function BookingsGridPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { date } = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const tz = loc.timezone ?? "America/Chicago";
  const dateKey =
    date && DAY_RE.test(date) ? date : DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
  const day = DateTime.fromISO(dateKey, { zone: tz });
  const prev = day.minus({ days: 1 }).toFormat("yyyy-LL-dd");
  const next = day.plus({ days: 1 }).toFormat("yyyy-LL-dd");
  const today = DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");

  const slots = await gridForDate(loc.id, dateKey, tz);
  const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

  // Group slots by start time (already sorted by startsAt).
  const groups: { time: string; slots: GridSlot[] }[] = [];
  for (const s of slots) {
    const time = fmtTime.format(s.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.time === time) last.slots.push(s);
    else groups.push({ time, slots: [s] });
  }

  const base = `/locations/${slug}/bookings`;
  const navCls =
    "inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <section>
      <PageHeader
        title="Bookings"
        description={day.toFormat("cccc, LLL d")}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`${base}?date=${prev}`} className={navCls} aria-label="Previous day">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            {dateKey !== today && (
              <Link href={`${base}?date=${today}`} className={navCls}>
                Today
              </Link>
            )}
            <Link href={`${base}?date=${next}`} className={navCls} aria-label="Next day">
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link
              href={`${base}/new`}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" /> New booking
            </Link>
          </div>
        }
      />

      <ViewToggle base={base} active="grid" />

      {groups.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <p className="text-sm text-zinc-500">No availability on this day.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.time} className="flex gap-3">
              <div className="w-20 shrink-0 pt-2 text-right text-sm font-medium text-zinc-500">
                {g.time}
              </div>
              <div className="flex-1 space-y-2">
                {g.slots.map((s) => (
                  <SlotBlock key={s.availabilityId} slug={slug} dateKey={dateKey} slot={s} fmtTime={fmtTime} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SlotBlock({
  slug,
  dateKey,
  slot,
  fmtTime,
}: {
  slug: string;
  dateKey: string;
  slot: GridSlot;
  fmtTime: Intl.DateTimeFormat;
}) {
  const tone = itemColor(slot.itemId);
  const total = slot.available != null ? slot.booked + slot.available : null;
  const pct = total && total > 0 ? Math.min(100, Math.round((slot.booked / total) * 100)) : 0;
  const closed = slot.onlineStatus === "off";

  return (
    <Link
      href={`/locations/${slug}/manifest?date=${dateKey}#slot-${slot.availabilityId}`}
      className="relative block overflow-hidden rounded-lg border border-zinc-200 bg-white pl-3 pr-3 py-2 transition-shadow hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <span className={`absolute left-0 top-0 h-full w-1.5 ${TONE_DOT[tone]}`} />
      <div className="ml-1.5">
        <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {closed && <Lock className="h-3.5 w-3.5 text-zinc-400" />}
          <span>{fmtTime.format(slot.startsAt)}</span>
          <span className="text-zinc-600 dark:text-zinc-300">{slot.itemName}</span>
          {slot.full && <Badge tone="red">Full</Badge>}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-sm ${TONE_DOT[tone]}`} />
            {slot.booked} booked
          </span>
          {slot.available != null && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm border border-zinc-300 dark:border-zinc-600" />
              {slot.available} available
            </span>
          )}
        </div>
      </div>
      {total != null && (
        <span className="absolute bottom-0 left-0 h-1 w-full bg-zinc-100 dark:bg-zinc-800">
          <span className={`block h-full ${TONE_DOT[tone]}`} style={{ width: `${pct}%` }} />
        </span>
      )}
    </Link>
  );
}
