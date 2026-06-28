import { and, eq, gte, notInArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { rrulestr } from "rrule";
import {
  availabilities,
  availabilitySchedules,
  getDb,
  items,
  locations,
} from "@/lib/db";
import type { AvailabilitySchedule } from "@/lib/db/schema";

// Turns recurring availability_schedules into concrete availabilities rows.
//
// The RRULE encodes recurrence only (weekdays + season DTSTART/UNTIL) in naive
// terms; wall-clock time lives in startTimesLocal. We expand the RRULE to dates
// over the materialize window, then place each (date × start time) in the
// location's IANA timezone and convert to a UTC instant via luxon (DST-correct).

export type GeneratedSlot = { startsAt: Date; endsAt: Date };

type ExpandableSchedule = Pick<
  AvailabilitySchedule,
  "rruleText" | "startTimesLocal" | "durationMinutes" | "materializeDaysAhead"
>;

// UTC-midnight of `now`'s calendar day — the floor for "today and forward".
function utcDayFloor(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function expandScheduleToSlots(
  schedule: ExpandableSchedule,
  timezone: string | null,
  now: Date,
): GeneratedSlot[] {
  if (!timezone || schedule.startTimesLocal.length === 0) return [];

  let rule;
  try {
    rule = rrulestr(schedule.rruleText);
  } catch {
    return [];
  }

  // Recurrence occurrences are date-only at 00:00Z (DTSTART is a floating date).
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

// (Re)generate the concrete slots for one schedule, idempotently:
//   - insert-missing (onConflictDoNothing on the unique (schedule_id, starts_at))
//   - prune future slots that are no longer in the computed set
// Paused/no-timezone schedules just get their future slots removed.
//
// NOTE: once bookings exist, the prune/delete must exclude booked slots — the
// bookings.availability_id FK is onDelete: restrict, so a delete of a booked
// slot would throw (a safe failure, but to be handled in a later sprint).
export async function materializeScheduleRow(
  schedule: AvailabilitySchedule,
  timezone: string | null,
  now: Date,
): Promise<{ inserted: number; deleted: number }> {
  const db = getDb();
  const floor = utcDayFloor(now);

  if (!schedule.active || !timezone) {
    const del = await db
      .delete(availabilities)
      .where(
        and(
          eq(availabilities.scheduleId, schedule.id),
          gte(availabilities.startsAt, floor),
        ),
      )
      .returning({ id: availabilities.id });
    return { inserted: 0, deleted: del.length };
  }

  const slots = expandScheduleToSlots(schedule, timezone, now);

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

  // Prune stale future slots (removed times/days, shrunk season).
  const keep = slots.map((s) => s.startsAt);
  const del = await db
    .delete(availabilities)
    .where(
      and(
        eq(availabilities.scheduleId, schedule.id),
        gte(availabilities.startsAt, floor),
        keep.length > 0
          ? notInArray(availabilities.startsAt, keep)
          : undefined,
      ),
    )
    .returning({ id: availabilities.id });

  return { inserted, deleted: del.length };
}

// Nightly cron entrypoint: roll every active schedule's window forward.
export async function materializeAllActiveSchedules(
  now: Date,
): Promise<{ schedules: number; inserted: number; deleted: number }> {
  const db = getDb();
  const rows = await db
    .select({ sched: availabilitySchedules, tz: locations.timezone })
    .from(availabilitySchedules)
    .innerJoin(items, eq(availabilitySchedules.itemId, items.id))
    .innerJoin(locations, eq(items.locationId, locations.id))
    .where(eq(availabilitySchedules.active, true));

  let inserted = 0;
  let deleted = 0;
  for (const r of rows) {
    const res = await materializeScheduleRow(r.sched, r.tz, now);
    inserted += res.inserted;
    deleted += res.deleted;
  }
  return { schedules: rows.length, inserted, deleted };
}
