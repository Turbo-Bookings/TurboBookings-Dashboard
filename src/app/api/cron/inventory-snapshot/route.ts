import { eq } from "drizzle-orm";
import { emitEvent } from "@/lib/events/emit";
import { buildInventorySnapshotPayload } from "@/lib/events/inventorySnapshotPayload";
import { getDb, locations } from "@/lib/db";

// Hourly capacity snapshot → the ad cockpit.
//
// Hourly rather than daily because the booking window is tiny: a median lead time of ~0.2 days in
// Houston means a Saturday can go from half empty to sold out between two daily runs, and a stale
// snapshot is worse than none — it reads as confident, current capacity.
//
// Cost is ~7 queries per location per run. Negligible.

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // dev bypass
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const now = new Date();
  const emitted: string[] = [];
  const skipped: { slug: string; reason: string }[] = [];

  try {
    const rows = await getDb()
      .select({ id: locations.id, slug: locations.slug, timezone: locations.timezone })
      .from(locations)
      .where(eq(locations.status, "launched"));

    for (const loc of rows) {
      // A location with no timezone is skipped and NAMED, never defaulted to UTC. Guessing shifts
      // Saturday evening into Sunday and mislabels the exact cell the cockpit steers on — a wrong
      // answer that looks right is worse than a missing one.
      if (!loc.timezone) {
        skipped.push({ slug: loc.slug, reason: "no timezone" });
        continue;
      }
      try {
        const data = await buildInventorySnapshotPayload(
          { ...loc, timezone: loc.timezone } as Parameters<
            typeof buildInventorySnapshotPayload
          >[0],
          now,
        );
        await emitEvent({
          event_type: "inventory.snapshot",
          location_id: loc.id,
          source_surface: "dashboard",
          data,
          // Supersedes rather than accumulates — see the flag's docs in emit.ts. A replayed snapshot
          // would overwrite a fresher one, and a backlog would compete with booking.created for the
          // shared drain budget.
          queue_on_failure: false,
        });
        emitted.push(loc.slug);
      } catch (err) {
        // One bad location must not stop the others — a market with a broken catalog should not cost
        // the other two their snapshot.
        console.error("inventory-snapshot failed for", loc.slug, err);
        skipped.push({
          slug: loc.slug,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return Response.json({ ok: true, emitted, skipped, captured_at: now.toISOString() });
  } catch (err) {
    console.error("inventory-snapshot cron failed", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
