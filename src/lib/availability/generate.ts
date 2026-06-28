import { and, eq, gte, notInArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { rrulestr } from "rrule";
import {
  availabilities,
  availabilitySchedules,
  blackoutDates,
  bookings,
  getDb,
  items,
  locations,
} from "@/lib/db";
import type { AvailabilitySchedule } from "@/lib/db/schema";

// Turns recurring availability_schedules into concrete availabilities rows.
//
// The RRULE encodes recurrence only (weekdays + season DTSTART/UNTIL) in naive
// terms; wall-clock time lives in startTimesLocal. We expand the RRULE to dates
// over the materialize window, drop any blacked-out day, then place each
// (date × start time) in the location's IANA timezone and convert to a UTC
// instant via luxon (DST-correct).

export type GeneratedSlot = { startsAt: Date; endsAt: Date };

type ExpandableSchedule = Pick<
  AvailabilitySchedule,
  "rruleText" | "startTimesLocal" | "durationMinutes" | "materializeDaysAhead"
>;

type BlackoutRow = { startDate: string; endDate: string | null; itemId: string | null };

const pad = (n: number) => String(n).padStart(2, "0");

// UTC-midnight of `now`'s calendar day — the floor for "today and forward".
function utcDayFloor(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// Expand blackout rows (single day or start..end range) into a set of local
// "YYYY-MM-DD" keys.
export function blackoutKeysFromRows(
  rows: Array<{ startDate: string; endDate: string | null }>,
): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    let cur = DateTime.fromISO(r.startDate, { zone: "utc" });
    const end = DateTime.fromISO(r.endDate ?? r.startDate, { zone: "utc" });
    if (!cur.isValid || !end.isValid) continue;
    let guard = 0;
    while (cur <= end && guard < 1000) {
      keys.add(cur.toFormat("yyyy-LL-dd"));
      cur = cur.plus({ days: 1 });
      guard++;
    }
  }
  return keys;
}

// Load the set of blacked-out local dates that apply to a given item at a
// location (location-wide blackouts have itemId null).
export async function loadBlackoutKeySet(
  locationId: string,
  itemId?: string | null,
): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({
      startDate: blackoutDates.startDate,
      endDate: blackoutDates.endDate,
      itemId: blackoutDates.itemId,
    })
    .from(blackoutDates)
    .where(eq(blackoutDates.locationId, locationId));
  return blackoutKeysFromRows(applicableRows(rows, itemId));
}

function applicableRows(rows: BlackoutRow[], itemId?: string | null): BlackoutRow[] {
  return rows.filter(
    (r) => r.itemId == null || (itemId != null && r.itemId === itemId),
  );
}

// Subquery of availability ids that have a booking — never deleted by
// regeneration (bookings.availability_id FK is onDelete: restrict).
function bookedSlotIds() {
  const db = getDb();
  return db.select({ id: bookings.availabilityId }).from(bookings);
}

export function expandScheduleToSlots(
  schedule: ExpandableSchedule,
  timezone: string | null,
  now: Date,
  blackoutKeys: Set<string> = new Set(),
): GeneratedSlot[] {
  if (!timezone || schedule.startTimesLocal.length === 0) return [];

  let rule;
  try {
    rule = rrulestr(schedule.rruleText);
  } catch {
    return [];
  }

  const windowStart = utcDayFloor(now);
  const windowEnd = new Date(
    windowStart.getTime() + schedule.materializeDaysAhead * 86_400_000,
  );
  const dates = rule.between(windowStart, windowEnd, true);

  const slots: GeneratedSlot[] = [];
  for (const d of dates) {
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const dateKey = `${year}-${pad(month)}-${pad(day)}`;
    if (blackoutKeys.has(dateKey)) continue;
    for (const t of schedule.startTimesLocal) {
      const [h, m] = t.split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
      const local = DateTime.fromObject(
        { year, month, day, hour: h, minute: m },
        { zone: timezone },
      );
      if (!local.isValid) continue; // e.g. the spring-forward DST gap
      const startsAt = local.toUTC().toJSDate();
      const endsAt = new Date(
        startsAt.getTime() + schedule.durationMinutes * 60_000,
      );
      slots.push({ startsAt, endsAt });
    }
  }
  return slots;
}

// (Re)generate one schedule's slots idempotently: insert-missing
// (onConflictDoNothing on unique (schedule_id, starts_at)) + prune future slots
// no longer in the computed set. Booked slots are never pruned. Paused / no-tz /
// fully-blacked-out schedules just get their (unbooked) future slots removed.
export async function materializeScheduleRow(
  schedule: AvailabilitySchedule,
  timezone: string | null,
  now: Date,
  blackoutKeys: Set<string> = new Set(),
): Promise<{ inserted: number; deleted: number }> {
  const db = getDb();
  const floor = utcDayFloor(now);

  const slots =
    schedule.active && timezone
      ? expandScheduleToSlots(schedule, timezone, now, blackoutKeys)
      : [];

  let inserted = 0;
  if (slots.length > 0) {
    const ins = await db
      .insert(availabilities)
      .values(
        slots.map((s) => ({
          itemId: schedule.itemId,
          scheduleId: schedule.id,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          onlineBookingStatus: schedule.defaultOnlineBookingStatus,
          capacityOverride: null,
        })),
      )
      .onConflictDoNothing({
        target: [availabilities.scheduleId, availabilities.startsAt],
      })
      .returning({ id: availabilities.id });
    inserted = ins.length;
  }

  // Prune stale future slots (removed times/days, shrunk season, blackout,
  // paused) — but never a booked slot.
  const keep = slots.map((s) => s.startsAt);
  const del = await db
    .delete(availabilities)
    .where(
      and(
        eq(availabilities.scheduleId, schedule.id),
        gte(availabilities.startsAt, floor),
        notInArray(availabilities.id, bookedSlotIds()),
        keep.length > 0 ? notInArray(availabilities.startsAt, keep) : undefined,
      ),
    )
    .returning({ id: availabilities.id });

  return { inserted, deleted: del.length };
}

// Re-materialize every active schedule for one location (used after a blackout
// is added/removed so existing slots reconcile immediately).
export async function materializeLocationActiveSchedules(
  locationId: string,
  now: Date,
): Promise<{ schedules: number; inserted: number; deleted: number }> {
  const db = getDb();
  const locRow = (
    await db
      .select({ tz: locations.timezone })
      .from(locations)
      .where(eq(locations.id, locationId))
      .limit(1)
  )[0];
  const tz = locRow?.tz ?? null;

  const blackoutRows = await db
    .select({
      startDate: blackoutDates.startDate,
      endDate: blackoutDates.endDate,
      itemId: blackoutDates.itemId,
    })
    .from(blackoutDates)
    .where(eq(blackoutDates.locationId, locationId));

  const scheds = await db
    .select({ sched: availabilitySchedules })
    .from(availabilitySchedules)
    .innerJoin(items, eq(availabilitySchedules.itemId, items.id))
    .where(
      and(eq(items.locationId, locationId), eq(availabilitySchedules.active, true)),
    );

  let inserted = 0;
  let deleted = 0;
  for (const { sched } of scheds) {
    const keys = blackoutKeysFromRows(applicableRows(blackoutRows, sched.itemId));
    const res = await materializeScheduleRow(sched, tz, now, keys);
    inserted += res.inserted;
    deleted += res.deleted;
  }
  return { schedules: scheds.length, inserted, deleted };
}

// Nightly cron entrypoint: roll every active schedule's window forward.
export async function materializeAllActiveSchedules(
  now: Date,
): Promise<{ schedules: number; inserted: number; deleted: number }> {
  const db = getDb();
  const rows = await db
    .select({
      sched: availabilitySchedules,
      locationId: items.locationId,
      tz: locations.timezone,
    })
    .from(availabilitySchedules)
    .innerJoin(items, eq(availabilitySchedules.itemId, items.id))
    .innerJoin(locations, eq(items.locationId, locations.id))
    .where(eq(availabilitySchedules.active, true));

  const allBlackouts = await db
    .select({
      locationId: blackoutDates.locationId,
      startDate: blackoutDates.startDate,
      endDate: blackoutDates.endDate,
      itemId: blackoutDates.itemId,
    })
    .from(blackoutDates);
  const blackoutsByLocation = new Map<string, BlackoutRow[]>();
  for (const b of allBlackouts) {
    const list = blackoutsByLocation.get(b.locationId) ?? [];
    list.push(b);
    blackoutsByLocation.set(b.locationId, list);
  }

  let inserted = 0;
  let deleted = 0;
  for (const r of rows) {
    const keys = blackoutKeysFromRows(
      applicableRows(blackoutsByLocation.get(r.locationId) ?? [], r.sched.itemId),
    );
    const res = await materializeScheduleRow(r.sched, r.tz, now, keys);
    inserted += res.inserted;
    deleted += res.deleted;
  }
  return { schedules: rows.length, inserted, deleted };
}
