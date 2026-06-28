import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { BlackoutToggle } from "@/components/BlackoutToggle";
import { SlotControls } from "@/components/SlotControls";
import { blackoutKeysFromRows } from "@/lib/availability/generate";
import {
  listSlotsForDay,
  slotCountsForMonth,
} from "@/lib/data/availability";
import { listBlackouts } from "@/lib/data/blackouts";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ month?: string; day?: string }>;
};

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function covers(b: { startDate: string; endDate: string | null }, day: string) {
  const end = b.endDate ?? b.startDate;
  return b.startDate <= day && day <= end;
}

export default async function CalendarPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { month, day } = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const zone = loc.timezone ?? "utc";
  const monthStr =
    month && MONTH_RE.test(month)
      ? month
      : DateTime.now().setZone(zone).toFormat("yyyy-LL");
  const [y, m] = monthStr.split("-").map(Number);
  const first = DateTime.fromObject({ year: y, month: m, day: 1 }, { zone });

  const [counts, blackouts] = await Promise.all([
    slotCountsForMonth(loc.id, y, m, zone),
    listBlackouts(loc.id),
  ]);
  const locationWide = blackouts.filter((b) => b.itemId == null);
  const blackoutKeys = blackoutKeysFromRows(locationWide);

  const base = `/locations/${slug}/catalog/schedule`;
  const cal = `${base}/calendar`;
  const prev = first.minus({ months: 1 }).toFormat("yyyy-LL");
  const next = first.plus({ months: 1 }).toFormat("yyyy-LL");

  const daysInMonth = first.daysInMonth ?? 30;
  const leadingBlanks = first.weekday % 7; // Sun=0 … Sat=6
  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ day: d, key: `${y}-${pad(m)}-${pad(d)}` });

  const selectedDay = day && DAY_RE.test(day) ? day : null;

  return (
    <section>
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Calendar — {first.toFormat("LLLL yyyy")}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Slot counts per day; click a day to manage its slots and blackouts.
            {loc.timezone ? (
              <>
                {" "}
                Times in <span className="font-mono">{loc.timezone}</span>.
              </>
            ) : (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {" "}
                No timezone set.
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href={`${cal}?month=${prev}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400">
            ← {first.minus({ months: 1 }).toFormat("LLL")}
          </Link>
          <Link href={`${cal}?month=${next}`} className="text-blue-600 hover:text-blue-800 dark:text-blue-400">
            {first.plus({ months: 1 }).toFormat("LLL")} →
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_HEADERS.map((w) => (
          <div
            key={w}
            className="px-2 py-1 text-center text-xs font-medium text-zinc-400"
          >
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={`b${i}`} />;
          const count = counts.get(c.key) ?? 0;
          const blacked = blackoutKeys.has(c.key);
          const isSelected = c.key === selectedDay;
          return (
            <Link
              key={c.key}
              href={`${cal}?month=${monthStr}&day=${c.key}`}
              className={`min-h-16 rounded-md border p-1.5 text-left transition-colors ${
                isSelected
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  {c.day}
                </span>
                {blacked && <span className="text-xs text-amber-600">✕</span>}
              </div>
              {!blacked && count > 0 && (
                <div className="mt-1 text-xs text-zinc-500">{count} slot{count === 1 ? "" : "s"}</div>
              )}
              {blacked && (
                <div className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                  Blackout
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {selectedDay && (
        <DayDetail
          slug={slug}
          locationId={loc.id}
          zone={zone}
          day={selectedDay}
          existingBlackoutId={
            locationWide.find((b) => covers(b, selectedDay))?.id ?? null
          }
        />
      )}
    </section>
  );
}

async function DayDetail({
  slug,
  locationId,
  zone,
  day,
  existingBlackoutId,
}: {
  slug: string;
  locationId: string;
  zone: string;
  day: string;
  existingBlackoutId: string | null;
}) {
  const slots = await listSlotsForDay(locationId, day, zone);
  const label = DateTime.fromISO(day, { zone }).toFormat("cccc, LLL d");

  return (
    <div className="mt-6 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          {label}
        </h3>
        <BlackoutToggle
          slug={slug}
          dateKey={day}
          existingBlackoutId={existingBlackoutId}
        />
      </div>

      {existingBlackoutId ? (
        <p className="px-4 py-6 text-center text-sm text-zinc-500">
          This day is blacked out — no bookable slots.
        </p>
      ) : slots.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-zinc-500">
          No slots on this day.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {slots.map((s) => {
            const start = DateTime.fromJSDate(s.startsAt).setZone(zone).toFormat("h:mm a");
            const end = DateTime.fromJSDate(s.endsAt).setZone(zone).toFormat("h:mm a");
            const isFixed = s.itemCapacityMode === "fixed";
            return (
              <li key={s.id}>
                <SlotControls
                  slug={slug}
                  id={s.id}
                  timeLabel={`${start}–${end}`}
                  itemName={s.itemName}
                  isFixed={isFixed}
                  status={s.onlineBookingStatus}
                  capacityValue={
                    s.capacityOverride != null ? String(s.capacityOverride) : ""
                  }
                  capacityHint={
                    s.scheduleCapacityPerSlot != null
                      ? String(s.scheduleCapacityPerSlot)
                      : "default"
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
