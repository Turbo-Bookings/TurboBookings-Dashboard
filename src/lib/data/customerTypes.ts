import "server-only";
import { asc, eq } from "drizzle-orm";
import { customerTypes, getDb } from "@/lib/db";
import type { CustomerType } from "@/lib/db/schema";

// Per-location customer-type pool (ticket types — e.g. Single Rider ATV,
// Double Rider, Spectator). Includes archived rows; the list view dims them
// and the edit form lets operators un-archive. New tour configurations only
// pick from non-archived rows.

export async function listCustomerTypes(
  locationId: string,
): Promise<CustomerType[]> {
  const db = getDb();
  return db
    .select()
    .from(customerTypes)
    .where(eq(customerTypes.locationId, locationId))
    .orderBy(asc(customerTypes.sortOrder), asc(customerTypes.createdAt));
}

export async function getCustomerTypeById(
  id: string,
  locationId: string,
): Promise<CustomerType | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(customerTypes)
    .where(eq(customerTypes.id, id))
    .limit(1);
  const row = rows[0];
  // Defense-in-depth: confirm the row belongs to the location in the URL.
  // Prevents an operator with multi-location access from editing a row
  // outside the current location by guessing IDs.
  if (!row || row.locationId !== locationId) return null;
  return row;
}
