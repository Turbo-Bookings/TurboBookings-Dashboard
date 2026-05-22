import "server-only";
import { eq } from "drizzle-orm";
import { getDb, locations } from "@/lib/db";

// Single source of truth for "fetch one location by slug." Used by the
// per-location layout and every per-location page. React 19 dedupes calls
// within the same request, so calling this from both layout + page is
// effectively a single DB hit per render.
export async function getLocationBySlug(slug: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}
