import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { availabilitySchedules, getDb, items } from "@/lib/db";
import type { AvailabilitySchedule } from "@/lib/db/schema";

// Recurring availability schedules (RRULE-driven). One row = "this tour runs on
// these weekdays at this time, this capacity, over this season window." Sprint D
// expands these into concrete `availabilities` slots. Schedules are scoped to a
// location through their item (availability_schedules has no locationId column).

export type ScheduleWithItem = AvailabilitySchedule & {
  itemName: string;
  itemCapacityMode: "resource_based" | "fixed";
};

export async function listSchedulesForLocation(
  locationId: string,
): Promise<ScheduleWithItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      sched: availabilitySchedules,
      itemName: items.name,
      itemCapacityMode: items.capacityMode,
    })
    .from(availabilitySchedules)
    .innerJoin(items, eq(availabilitySchedules.itemId, items.id))
    .where(eq(items.locationId, locationId))
    .orderBy(
      asc(items.sortOrder),
      asc(items.name),
      asc(availabilitySchedules.createdAt),
    );
  return rows.map(({ sched, itemName, itemCapacityMode }) => ({
    ...sched,
    itemName,
    itemCapacityMode,
  }));
}

// Tenancy-checked single fetch: returns the schedule only if its item belongs
// to the given location.
export async function getScheduleById(
  id: string,
  locationId: string,
): Promise<AvailabilitySchedule | null> {
  const db = getDb();
  const rows = await db
    .select({ sched: availabilitySchedules })
    .from(availabilitySchedules)
    .innerJoin(items, eq(availabilitySchedules.itemId, items.id))
    .where(
      and(eq(availabilitySchedules.id, id), eq(items.locationId, locationId)),
    )
    .limit(1);
  return rows[0]?.sched ?? null;
}
