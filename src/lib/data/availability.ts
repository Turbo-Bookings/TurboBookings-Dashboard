import "server-only";
import { and, asc, count, eq, gte, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { availabilities, availabilitySchedules, getDb, items } from "@/lib/db";

// Generated bookable slots (concrete availabilities). Read side for the
// operator's "generated slots" view; the customer flow reads this later too.

export type UpcomingSlot = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  onlineBookingStatus: "on" | "off" | "auto";
  capacityOverride: number | null;
  itemName: string;
  itemCapacityMode: "resource_based" | "fixed";
  scheduleCapacityPerSlot: number | null;
};

export async function listUpcomingAvailabilities(
  locationId: string,
  days = 14,
): Promise<UpcomingSlot[]> {
  const db = getDb();
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  return db
    .select({
      id: availabilities.id,
      startsAt: availabilities.startsAt,
      endsAt: availabilities.endsAt,
      onlineBookingStatus: availabilities.onlineBookingStatus,
      capacityOverride: availabilities.capacityOverride,
      itemName: items.name,
      itemCapacityMode: items.capacityMode,
      scheduleCapacityPerSlot: availabilitySchedules.capacityPerSlot,
    })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .leftJoin(
      availabilitySchedules,
      eq(availabilities.scheduleId, availabilitySchedules.id),
    )
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, now),
        lt(availabilities.startsAt, until),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
}

// Count of upcoming (future) generated slots for a location.
export async function countUpcomingAvailabilities(
  locationId: string,
): Promise<number> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({ c: count() })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .where(and(eq(items.locationId, locationId), gte(availabilities.startsAt, now)));
  return rows[0]?.c ?? 0;
}

// Slots whose LOCAL calendar date (in the location's timezone) equals dateKey.
export async function listSlotsForDay(
  locationId: string,
  dateKey: string,
  tz: string | null,
): Promise<UpcomingSlot[]> {
  const db = getDb();
  const zone = tz ?? "utc";
  const dayStart = DateTime.fromISO(dateKey, { zone }).startOf("day");
  if (!dayStart.isValid) return [];
  const start = dayStart.toUTC().toJSDate();
  const end = dayStart.plus({ days: 1 }).toUTC().toJSDate();
  return db
    .select({
      id: availabilities.id,
      startsAt: availabilities.startsAt,
      endsAt: availabilities.endsAt,
      onlineBookingStatus: availabilities.onlineBookingStatus,
      capacityOverride: availabilities.capacityOverride,
      itemName: items.name,
      itemCapacityMode: items.capacityMode,
      scheduleCapacityPerSlot: availabilitySchedules.capacityPerSlot,
    })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .leftJoin(
      availabilitySchedules,
      eq(availabilities.scheduleId, availabilitySchedules.id),
    )
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, start),
        lt(availabilities.startsAt, end),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
}

// Map of local "YYYY-MM-DD" -> slot count for a calendar month.
export async function slotCountsForMonth(
  locationId: string,
  year: number,
  month: number,
  tz: string | null,
): Promise<Map<string, number>> {
  const db = getDb();
  const zone = tz ?? "utc";
  const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone });
  if (!monthStart.isValid) return new Map();
  const start = monthStart.toUTC().toJSDate();
  const end = monthStart.plus({ months: 1 }).toUTC().toJSDate();
  const rows = await db
    .select({ startsAt: availabilities.startsAt })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, start),
        lt(availabilities.startsAt, end),
      ),
    );
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = DateTime.fromJSDate(r.startsAt).setZone(zone).toFormat("yyyy-LL-dd");
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

// Tenancy-checked single slot fetch.
export async function getSlot(
  slotId: string,
  locationId: string,
): Promise<{ id: string; itemId: string } | null> {
  const db = getDb();
  const rows = await db
    .select({ id: availabilities.id, itemId: availabilities.itemId })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .where(and(eq(availabilities.id, slotId), eq(items.locationId, locationId)))
    .limit(1);
  return rows[0] ?? null;
}
