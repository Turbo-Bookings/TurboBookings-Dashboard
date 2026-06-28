import "server-only";
import { asc, eq } from "drizzle-orm";
import { blackoutDates, getDb, items } from "@/lib/db";
import type { BlackoutDate } from "@/lib/db/schema";

// Operator-declared closed dates. itemName null = applies to all tours.
export type BlackoutWithItem = BlackoutDate & { itemName: string | null };

export async function listBlackouts(
  locationId: string,
): Promise<BlackoutWithItem[]> {
  const db = getDb();
  const rows = await db
    .select({ b: blackoutDates, itemName: items.name })
    .from(blackoutDates)
    .leftJoin(items, eq(blackoutDates.itemId, items.id))
    .where(eq(blackoutDates.locationId, locationId))
    .orderBy(asc(blackoutDates.startDate));
  return rows.map(({ b, itemName }) => ({ ...b, itemName }));
}
