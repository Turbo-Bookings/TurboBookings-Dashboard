import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, resources } from "@/lib/db";
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
