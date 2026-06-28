import "server-only";
import { and, asc, count, eq, gte, lt } from "drizzle-orm";
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
