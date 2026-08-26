/**
 * Apply Dallas Glow's 60 → 45 minute change to slots that already exist.
 *
 *   npx tsx scripts/retime-glow-slots.ts            # dry run
 *   npx tsx scripts/retime-glow-slots.ts --commit
 *
 * ## Why this script has to exist
 *
 * Changing a schedule's duration does NOT retime the slots it already made.
 * `materializeScheduleRow` matches existing rows by `startsAt` alone and inserts with
 * `onConflictDoNothing` — so a slot at 8:00 PM that already exists is skipped entirely, and its
 * `endsAt` is never rewritten. Nothing anywhere in the codebase ever updates `endsAt`.
 *
 * Since the Glow Tour's start times did not change, EVERY future slot matched an existing row and
 * kept `endsAt = start + 60`. Verified after the schedule save: 927 future slots, all still 60
 * minutes. The setting said 45 and the tours would have run an hour, for the 540-day horizon.
 *
 * ## What it deliberately does NOT touch
 *
 * **Slots with bookings.** Those guests bought a one-hour tour and keep it; the manifest flags them
 * with "Originally booked for 1 hour". This is why the note exists.
 *
 * **Slots with a live seat hold.** Someone is mid-checkout against a 60-minute slot right now.
 * Shortening it underneath them would change what they are paying for between the quote and the
 * charge.
 *
 * **Anything in the past.** History records what actually ran.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const COMMIT = process.argv.includes("--commit");
const NEW_MINUTES = 45;

function databaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  for (const f of [".env.production.local", ".env.local"]) {
    try {
      const raw = readFileSync(f, "utf8");
      const m =
        raw.match(/^DATABASE_URL_UNPOOLED="?([^"\n]+)"?/m) ??
        raw.match(/^DATABASE_URL="?([^"\n]+)"?/m);
      if (m?.[1]) return m[1];
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("No DATABASE_URL. Run `vercel env pull .env.production.local --environment=production`.");
}

async function main() {
  const sql = neon(databaseUrl());

  const item = (
    (await sql.query(
      `SELECT i.id, i.name, i.default_duration_minutes AS dur
         FROM items i JOIN locations l ON l.id = i.location_id
        WHERE l.slug = 'dtown' AND i.name ILIKE '%Glow%'`,
    )) as { id: string; name: string; dur: number }[]
  )[0];
  if (!item) throw new Error("Dallas Glow Tour not found");

  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} · ${item.name}\n`);

  // Future slots that are safe to retime: no booking of ANY status (matching the app's own
  // `deleteSlot` guard, which also ignores status) and no live hold.
  const safe = (await sql.query(
    `SELECT count(*)::int AS n FROM availabilities av
      WHERE av.item_id = $1 AND av.starts_at > now()
        AND extract(epoch FROM (av.ends_at - av.starts_at))/60 <> $2
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.availability_id = av.id)
        AND NOT EXISTS (SELECT 1 FROM seat_holds h WHERE h.availability_id = av.id AND h.expires_at > now())`,
    [item.id, NEW_MINUTES],
  )) as { n: number }[];

  const held = (await sql.query(
    `SELECT count(*)::int AS n FROM availabilities av
      WHERE av.item_id = $1 AND av.starts_at > now()
        AND EXISTS (SELECT 1 FROM seat_holds h WHERE h.availability_id = av.id AND h.expires_at > now())`,
    [item.id],
  )) as { n: number }[];

  const booked = (await sql.query(
    `SELECT to_char(av.starts_at AT TIME ZONE 'America/Chicago', 'Dy Mon DD HH24:MI') AS local,
            to_char(av.starts_at AT TIME ZONE 'America/Chicago', 'Dy') AS dow,
            count(b.id)::int AS bookings
       FROM availabilities av
       JOIN bookings b ON b.availability_id = av.id AND b.status = 'active'
      WHERE av.item_id = $1 AND av.starts_at > now()
      GROUP BY 1, 2, av.starts_at ORDER BY av.starts_at`,
    [item.id],
  )) as { local: string; dow: string; bookings: number }[];

  console.log(`  retime to ${NEW_MINUTES} min : ${safe[0].n} unbooked future slots`);
  console.log(`  left at 60 min (booked)  : ${booked.length} slots`);
  if (held[0].n > 0) console.log(`  skipped, live seat hold  : ${held[0].n}`);

  console.log("\n  honoured at their original hour:");
  for (const b of booked) {
    const outside = !["Fri", "Sat", "Sun"].includes(b.dow.trim());
    console.log(`    ${b.local}  ${b.bookings} booking(s)${outside ? "   — off-schedule day, will be closed to new bookings" : ""}`);
  }

  if (!COMMIT) {
    console.log("\n  Nothing written. Re-run with --commit.");
    return;
  }

  const retimed = (await sql.query(
    `UPDATE availabilities av
        SET ends_at = av.starts_at + ($2 || ' minutes')::interval, updated_at = now()
      WHERE av.item_id = $1 AND av.starts_at > now()
        AND extract(epoch FROM (av.ends_at - av.starts_at))/60 <> $2
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.availability_id = av.id)
        AND NOT EXISTS (SELECT 1 FROM seat_holds h WHERE h.availability_id = av.id AND h.expires_at > now())
      RETURNING av.id`,
    [item.id, NEW_MINUTES],
  )) as unknown[];
  console.log(`\n  retimed: ${retimed.length}`);

  // Bookings survived onto days the tour no longer runs. The slot has to stay so the guest can check
  // in — but every read path joins `availabilities` directly with no filter on schedule membership,
  // so without this the orphan would remain quietly sellable to a new customer.
  const closed = (await sql.query(
    `UPDATE availabilities av
        SET online_booking_status = 'off', updated_at = now()
      WHERE av.item_id = $1 AND av.starts_at > now()
        AND av.online_booking_status <> 'off'
        AND extract(dow FROM (av.starts_at AT TIME ZONE 'America/Chicago')) NOT IN (0, 5, 6)
      RETURNING av.id`,
    [item.id],
  )) as unknown[];
  console.log(`  closed to new bookings (off-schedule days): ${closed.length}`);

  // Keep the tour's own duration in step, so the catalog reads 45 min and the manifest can tell an
  // old slot from a current one.
  await sql.query(`UPDATE items SET default_duration_minutes = $2, updated_at = now() WHERE id = $1`, [
    item.id,
    NEW_MINUTES,
  ]);
  console.log(`  items.default_duration_minutes → ${NEW_MINUTES}`);
}

main().catch((e) => {
  console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
