import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, locations } from "@/lib/db";

// Lightweight list for the sidebar location switcher.
export async function listLocationsForSwitcher(): Promise<
  { slug: string; name: string; status: string }[]
> {
  const db = getDb();
  const rows = await db
    .select({
      slug: locations.slug,
      name: locations.brandDisplayName,
      status: locations.status,
    })
    .from(locations)
    .orderBy(asc(locations.brandLocationLabel));
  return rows.map((r) => ({ slug: r.slug, name: r.name ?? r.slug, status: r.status }));
}

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
