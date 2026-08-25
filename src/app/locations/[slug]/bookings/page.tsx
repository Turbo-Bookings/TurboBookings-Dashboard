import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { DateJump } from "@/components/ui/DateJump";
import { TourVehicleSummary } from "@/components/TourVehicleSummary";
import { RecentBookings } from "@/components/RecentBookings";
import { SlotPopover } from "@/components/SlotPopover";
import { ViewToggle } from "@/app/locations/[slug]/bookings/list/page";
import { gridForDate, type GridSlot } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type View = "day" | "week" | "next7";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string; view?: string; booked?: string }>;
};

export default async function BookingsGridPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const tz = loc.timezone ?? "America/Chicago";
  const dateKey =
    sp.date && DAY_RE.test(sp.date) ? sp.date : DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
  const day = DateTime.fromISO(dateKey, { zone: tz });
  // day | week (calendar Mon–Sun) | next7 (rolling, from the shown date). Luxon's startOf("week") is
  // already Monday, so "week" is a calendar week without extra work; "next7" is the same grid seeded
  // from the day itself rather than from the start of its week.
  const view: View = sp.view === "week" ? "week" : sp.view === "next7" ? "next7" : "day";
  const bookedOnly = sp.booked === "1";
  const fmtTime = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

  const base = `/locations/${slug}/bookings`;
  const mk = (o: Partial<{ date: string; view: string; booked: string }>) => {
    const q = new URLSearchParams();
    const date = o.date ?? dateKey;
    if (date) q.set("date", date);
    const v = o.view ?? view;
    if (v !== "day") q.set("view", v);
    const b = o.booked ?? (bookedOnly ? "1" : "");
    if (b === "1") q.set("booked", "1");
    return `${base}?${q.toString()}`;
  };
  const filt = (arr: GridSlot[]) => (bookedOnly ? arr.filter((s) => s.booked > 0) : arr);

  // Date navigation steps by day or week.
  // Stepping matches the span on screen: a week view moves a week, a rolling window moves its own
  // length, a day moves a day.
  const step = view === "day" ? { days: 1 } : { weeks: 1 };
  const prev = day.minus(step).toFormat("yyyy-LL-dd");
  const next = day.plus(step).toFormat("yyyy-LL-dd");
  const today = DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");

  const navCls =
    "inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";
  const segOn = "bg-blue-600 text-white";
  const segOff = "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <section>
      <PageHeader
        title="Bookings"
        description={
          view === "week"
            ? `Week of ${day.startOf("week").toFormat("LLL d")}`
            : view === "next7"
              ? `${day.toFormat("LLL d")} – ${day.plus({ days: 6 }).toFormat("LLL d")}`
              : day.toFormat("cccc, LLL d")
        }
        actions={
          <div className="flex items-center gap-2">
            <Link href={mk({ date: prev })} className={navCls} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            {dateKey !== today && (
              <Link href={mk({ date: today })} className={navCls}>
                Today
              </Link>
            )}
            <Link href={mk({ date: next })} className={navCls} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Link>
            <DateJump value={dateKey} hrefFor={(d) => mk({ date: d })} />
            <RecentBookings slug={slug} tz={tz} />
            <Link href={`${base}/new`} data-tour="bookings-new" className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" /> New booking
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ViewToggle base={base} active="grid" />
        {/* Day / Week */}
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          <Link href={mk({ view: "day" })} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${view === "day" ? segOn : segOff}`}>
            <CalendarDays className="h-4 w-4" /> Day
          </Link>
          <Link href={mk({ view: "week" })} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${view === "week" ? segOn : segOff}`}>
            <CalendarRange className="h-4 w-4" /> Week
          </Link>
          <Link href={mk({ view: "next7" })} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium ${view === "next7" ? segOn : segOff}`}>
            <CalendarRange className="h-4 w-4" /> 7 days
          </Link>
        </div>
        {/* Booked only */}
        <Link
          href={mk({ booked: bookedOnly ? "" : "1" })}
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            bookedOnly
              ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          Booked only
        </Link>
      </div>

      {view !== "day" ? (
        <WeekGrid slug={slug} loc={{ id: loc.id, tz }} day={day} fmtTime={fmtTime} filt={filt} rolling={view === "next7"} />
      ) : (
        <DayGridWithSummary slug={slug} dateKey={dateKey} locId={loc.id} tz={tz} fmtTime={fmtTime} filt={filt} />
      )}
    </section>
  );
}

/**
 * The day's slots, fetched once and used twice — the per-tour vehicle totals above the grid, and the
 * grid itself. The summary counts every slot; the grid respects the "booked only" filter, so folding
 * the totals from the FILTERED list would make them disagree with the day the moment that is on.
 */
async function DayGridWithSummary({
  slug,
  dateKey,
  locId,
  tz,
  fmtTime,
  filt,
}: {
  slug: string;
  dateKey: string;
  locId: string;
  tz: string;
  fmtTime: Intl.DateTimeFormat;
  filt: (arr: GridSlot[]) => GridSlot[];
}) {
  const slots = await gridForDate(locId, dateKey, tz);
  return (
    <>
      <TourVehicleSummary slots={slots} />
      <DayGrid slug={slug} dateKey={dateKey} slots={filt(slots)} fmtTime={fmtTime} tz={tz} />
    </>
  );
}

function DayGrid({
  slug,
  dateKey,
  slots,
  fmtTime,
  tz,
}: {
  slug: string;
  dateKey: string;
  slots: GridSlot[];
  fmtTime: Intl.DateTimeFormat;
  tz: string;
}) {
  const groups: { time: string; slots: GridSlot[] }[] = [];
  for (const s of slots) {
    const time = fmtTime.format(s.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.time === time) last.slots.push(s);
    else groups.push({ time, slots: [s] });
  }
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
        <p className="text-sm text-zinc-500">No slots to show.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {groups.map((g) => (
        <div key={g.time} className="flex gap-3">
          <div className="w-20 shrink-0 pt-2 text-right text-sm font-medium text-zinc-500">{g.time}</div>
          <div className="flex-1 space-y-2">
            {g.slots.map((s) => (
              <SlotPopover key={s.availabilityId} slug={slug} dateKey={dateKey} slot={s} timeLabel={fmtTime.format(s.startsAt)} tz={tz} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

async function WeekGrid({
  slug,
  loc,
  day,
  fmtTime,
  filt,
  rolling,
}: {
  slug: string;
  loc: { id: string; tz: string };
  day: DateTime;
  fmtTime: Intl.DateTimeFormat;
  filt: (arr: GridSlot[]) => GridSlot[];
  /** Seven days from the shown date, rather than the calendar week containing it. */
  rolling?: boolean;
}) {
  // One grid, two windows. A calendar week answers "how did last week go" and lines up with how
  // people talk about a work week; a rolling seven answers "what is coming". Luxon's startOf("week")
  // is Monday, which is the convention the venue uses.
  const start = rolling ? day : day.startOf("week");
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const slotsByDay = await Promise.all(
    days.map((d) => gridForDate(loc.id, d.toFormat("yyyy-LL-dd"), loc.tz)),
  );

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {days.map((d, i) => {
        const dk = d.toFormat("yyyy-LL-dd");
        const slots = filt(slotsByDay[i]);
        return (
          <div key={dk} className="min-w-0">
            <div className="mb-2 text-center text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              {d.toFormat("ccc")} <span className="text-zinc-400">{d.toFormat("M/d")}</span>
            </div>
            <div className="space-y-1.5">
              {slots.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-200 py-3 text-center text-[10px] text-zinc-400 dark:border-zinc-800">
                  —
                </p>
              ) : (
                slots.map((s) => (
                  <SlotPopover key={s.availabilityId} slug={slug} dateKey={dk} slot={s} timeLabel={fmtTime.format(s.startsAt)} tz={loc.tz} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
