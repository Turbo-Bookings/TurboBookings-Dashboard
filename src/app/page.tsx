import Link from "next/link";
import { asc, sql } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { getDb, locations } from "@/lib/db";

// The home page queries the live DB on every render — Next would otherwise
// prerender it at build time and serve a stale snapshot. force-dynamic
// guarantees every request gets fresh location data.
export const dynamic = "force-dynamic";

// Sort order: launched first (the steady state most often viewed), then
// building, draft, paused, archived. CASE expression encodes the priority.
const STATUS_ORDER = sql`
  CASE ${locations.status}
    WHEN 'launched' THEN 0
    WHEN 'building' THEN 1
    WHEN 'draft' THEN 2
    WHEN 'paused' THEN 3
    WHEN 'archived' THEN 4
  END
`;

async function listLocations() {
  const db = getDb();
  return db
    .select()
    .from(locations)
    .orderBy(STATUS_ORDER, asc(locations.brandLocationLabel));
}

export default async function HomePage() {
  const rows = await listLocations();

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Locations</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {rows.length} {rows.length === 1 ? "location" : "locations"}
          </p>
        </div>
        {/* Placeholder for + New Location button (next commit) */}
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">City</th>
              <th className="px-4 py-3 font-medium">Domain</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((loc) => (
              <tr
                key={loc.id}
                className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-950/50"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/locations/${loc.slug}`}
                    className="font-medium text-zinc-900 hover:text-blue-600 dark:text-zinc-100 dark:hover:text-blue-400"
                  >
                    {loc.brandDisplayName ?? loc.slug}
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                  {loc.brandLocationLabel ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                  {loc.domainApex ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={loc.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
