import "server-only";
import { asc, eq } from "drizzle-orm";
import {
  customerTypes,
  getDb,
  items,
  resourceRequirements,
  resources,
} from "@/lib/db";
import type { Resource } from "@/lib/db/schema";

// Per-location capacity pool. One row per "kind of thing this location has"
// — e.g. ATVs (12 of them), UTVs (4 of them), Guides (3 of them). Items
// declare what they consume per (item × customer_type) via
// resource_requirements.

export async function listResources(
  locationId: string,
): Promise<Resource[]> {
  const db = getDb();
  return db
    .select()
    .from(resources)
    .where(eq(resources.locationId, locationId))
    .orderBy(asc(resources.sortOrder), asc(resources.createdAt));
}

export async function getResourceById(
  id: string,
  locationId: string,
): Promise<Resource | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(resources)
    .where(eq(resources.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.locationId !== locationId) return null;
  return row;
}

/**
 * What each pool is actually used by — the tours and rider options that draw on it.
 *
 * The Resources list showed a name and two numbers and nothing about consequences, which is fine
 * while a location has one pool per vehicle kind. Once a fleet is split by size, "4-Seat UTVs: 1
 * total, 1 out of service" gives an operator no way to see that it is the 4-Seat option on both UTV
 * tours that just went dark. This is the missing half of that screen.
 */
export async function resourceUsageSummary(
  locationId: string,
): Promise<Map<string, { itemName: string; optionName: string }[]>> {
  const rows = await getDb()
    .select({
      resourceId: resourceRequirements.resourceId,
      itemName: items.name,
      optionName: customerTypes.singular,
    })
    .from(resourceRequirements)
    .innerJoin(items, eq(items.id, resourceRequirements.itemId))
    .innerJoin(customerTypes, eq(customerTypes.id, resourceRequirements.customerTypeId))
    .where(eq(items.locationId, locationId))
    .orderBy(asc(items.sortOrder), asc(customerTypes.sortOrder));

  const out = new Map<string, { itemName: string; optionName: string }[]>();
  for (const r of rows) {
    const list = out.get(r.resourceId);
    if (list) list.push({ itemName: r.itemName, optionName: r.optionName });
    else out.set(r.resourceId, [{ itemName: r.itemName, optionName: r.optionName }]);
  }
  return out;
}
