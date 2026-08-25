import "server-only";
import { and, asc, count, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { fixedRemaining, resourceRemaining, type ResourcePool } from "@/lib/booking/capacity";
import { overlappingResourceUsage } from "@/lib/availability/resourceUsage";
import {
  availabilities,
  availabilitySchedules,
  bookingLines,
  bookings,
  getDb,
  items,
  resourceRequirements,
  resources,
} from "@/lib/db";

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
): Promise<{ id: string; itemId: string; startsAt: Date; endsAt: Date } | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: availabilities.id,
      itemId: availabilities.itemId,
      startsAt: availabilities.startsAt,
      endsAt: availabilities.endsAt,
    })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .where(and(eq(availabilities.id, slotId), eq(items.locationId, locationId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Open slots for a tour — the ones a rep or the reschedule picker can move a booking into.
 *
 * Lives here rather than in `actions/manualBooking.ts` because it is a QUERY, not an action. Every
 * export of a `"use server"` file is a POST endpoint, so keeping a plain data lookup in one published
 * it as a callable surface that took a raw location id and checked nothing — for no benefit, since
 * both of its callers are already-guarded actions in other files.
 */
export async function openSlotsForItem(
  locationId: string,
  itemId: string,
  days = 60,
): Promise<{ id: string; startsAt: Date; remaining: number }[]> {
  const db = getDb();
  const item = (
    await db
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.locationId, locationId)))
      .limit(1)
  )[0];
  if (!item) return [];
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  const slots = await db
    .select({ a: availabilities, cap: availabilitySchedules.capacityPerSlot })
    .from(availabilities)
    .leftJoin(availabilitySchedules, eq(availabilities.scheduleId, availabilitySchedules.id))
    .where(
      and(
        eq(availabilities.itemId, itemId),
        gte(availabilities.startsAt, now),
        lt(availabilities.startsAt, until),
        ne(availabilities.onlineBookingStatus, "off"),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
  if (slots.length === 0) return [];

  const ids = slots.map((s) => s.a.id);
  const booked = await db
    .select({ availabilityId: bookings.availabilityId, qty: bookingLines.quantity })
    .from(bookings)
    .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .where(and(inArray(bookings.availabilityId, ids), eq(bookings.status, "active")));
  const bySlot = new Map<string, number>();
  for (const b of booked) bySlot.set(b.availabilityId, (bySlot.get(b.availabilityId) ?? 0) + b.qty);

  let pools: { resourceId: string; max: number; oos: number; maxQ: number }[] = [];
  if (item.capacityMode === "resource_based") {
    const rr = await db
      .select({ rr: resourceRequirements, r: resources })
      .from(resourceRequirements)
      .innerJoin(resources, eq(resourceRequirements.resourceId, resources.id))
      .where(eq(resourceRequirements.itemId, itemId));
    const byRes = new Map<string, { max: number; oos: number; maxQ: number }>();
    for (const { rr: req, r } of rr) {
      const cur = byRes.get(r.id);
      if (!cur) byRes.set(r.id, { max: r.maxConcurrentUses, oos: r.outOfServiceCount, maxQ: req.quantityConsumed });
      else cur.maxQ = Math.max(cur.maxQ, req.quantityConsumed);
    }
    pools = [...byRes.entries()].map(([resourceId, v]) => ({ resourceId, ...v }));
  }

  // Shared-pool usage: peak concurrent use of each resource by EVERY tour overlapping the slot, not
  // just this one. Without it, two tours on the same machines each see the whole fleet as free.
  const usage =
    item.capacityMode === "resource_based"
      ? await overlappingResourceUsage(
          slots.map(({ a }) => ({ id: a.id, startsAt: a.startsAt, endsAt: a.endsAt })),
          item.locationId,
        )
      : new Map();

  return slots.map(({ a, cap }) => {
    const bk = bySlot.get(a.id) ?? 0;
    const slotUsage = usage.get(a.id);
    const remaining =
      item.capacityMode === "fixed"
        ? fixedRemaining(a.capacityOverride ?? cap, bk)
        : resourceRemaining(
            pools.map<ResourcePool>((p) => ({
              maxConcurrentUses: p.max,
              outOfServiceCount: p.oos,
              maxQuantityConsumed: p.maxQ,
              consumed: slotUsage?.get(p.resourceId) ?? 0,
            })),
          );
    return { id: a.id, startsAt: a.startsAt, remaining };
  });
}
