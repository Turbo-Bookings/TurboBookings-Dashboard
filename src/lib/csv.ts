import "server-only";
import { can, type Capability } from "@/lib/auth/roles";

/**
 * Shared pieces for the CSV export routes.
 *
 * These are route handlers, not pages — **a subtree `layout.tsx` does not run for them.** That is not
 * a subtlety anyone should have to re-discover: all three exports (bookings, sales tax, manifest) sat
 * under gated layouts and were themselves reachable by any signed-in user with any role at the
 * location, so a front-line account could download a full revenue export by typing the URL. Nothing
 * in the code said so, because the gate looked like it was one directory up.
 *
 * `guardExport` makes the check impossible to leave out: it returns the location or a Response, and
 * the caller cannot get a location id without going through it.
 */

/** `YYYY-MM-DD`, the query-param format every export and every dated page uses. */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One CSV field, quoted, with embedded quotes doubled per RFC 4180. */
export function cell(s: string | number): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}

/** A finished CSV download. Rows are arrays of already-`cell()`-safe values. */
export function csvResponse(
  filename: string,
  header: string[],
  rows: (string | number)[][],
): Response {
  const body = [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** Parse a `YYYY-MM-DD` search param, falling back to `fallback`. */
export function dayParam(url: URL, name: string, fallback: string): string {
  const v = url.searchParams.get(name);
  return v && DAY_RE.test(v) ? v : fallback;
}

/**
 * Resolve the location for an export, refusing unless the caller holds `cap`.
 *
 * 404 rather than 403 throughout, matching `requirePageCapability` — an export you may not have
 * should not confirm it exists.
 */
export async function guardExport(
  slug: string,
  cap: Capability,
): Promise<
  | { ok: true; location: NonNullable<Awaited<ReturnType<typeof import("@/lib/data/locations").getLocationBySlug>>> }
  | { ok: false; response: Response }
> {
  const { getLocationBySlug } = await import("@/lib/data/locations");
  const location = await getLocationBySlug(slug);
  if (!location || !(await can(cap, slug))) {
    return { ok: false, response: new Response("Not found", { status: 404 }) };
  }
  return { ok: true, location };
}
