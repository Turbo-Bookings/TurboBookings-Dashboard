"use server";

import { and, eq, gt, isNotNull, notExists, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import {
  availabilities,
  bookings,
  customers,
  getDb,
  locations,
  scheduledEmails,
} from "@/lib/db";
import { denyIfCannot } from "@/lib/auth/roles";
import { notifyManualBookingEmails } from "@/lib/booking/lifecycleTrigger";

/**
 * Arm 24h/2h reminders for bookings brought over from another system.
 *
 * A booking taken on our own checkout schedules its own reminders. One imported
 * from a CSV never went through that code path, so 317 Houston bookings arrived
 * with none — the customers would simply not be reminded.
 *
 * This exists as a dashboard action rather than a CLI script because the script
 * CANNOT WORK from a developer machine: scheduling runs through the booking
 * app's authenticated internal endpoint, and `vercel env pull` returns sensitive
 * values as empty strings, so `INTERNAL_API_SECRET` is always blank locally. A
 * server action runs inside Vercel where the secret actually exists. It also
 * means the next location's reminders can be armed by whoever does the import,
 * without a terminal or a copied credential.
 */

const CHUNK = 8; // concurrent internal calls
const MAX_PER_RUN = 120; // keep one invocation well inside the function timeout

/** Imported, still active, real email, tour far enough out to still be reminded. */
function eligible(locationId: string) {
  return and(
    eq(bookings.locationId, locationId),
    eq(bookings.status, "active"),
    isNotNull(bookings.externalRef),
    // Synthesised addresses from an import with no email can never receive mail.
    sql`${customers.emailLower} NOT LIKE '%@import.invalid'`,
    // A 24h reminder for a tour in 20 hours has already missed its send time.
    gt(availabilities.startsAt, sql`now() + interval '25 hours'`),
    notExists(
      getDb()
        .select({ one: sql`1` })
        .from(scheduledEmails)
        .where(
          and(
            eq(scheduledEmails.bookingId, bookings.id),
            eq(scheduledEmails.type, "reminder_24h"),
          ),
        ),
    ),
  );
}

export type ImportedReminderCount = { pending: number };

export async function countImportedWithoutReminders(
  slug: string,
): Promise<ImportedReminderCount> {
  const db = getDb();
  const loc = (
    await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1)
  )[0];
  if (!loc) return { pending: 0 };
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .innerJoin(availabilities, eq(availabilities.id, bookings.availabilityId))
    .where(eligible(loc.id));
  return { pending: rows[0]?.n ?? 0 };
}

export type ArmResult =
  | { ok: true; armed: number; failed: number; remaining: number }
  | { ok: false; error: string };

export async function armImportedReminders(slug: string): Promise<ArmResult> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny };

  // Fail before sending anything rather than reporting success for no-ops. The
  // CLI version of this counted 317 successes while the secret was empty and
  // nothing was scheduled; that is the failure mode this check exists for.
  if (!process.env.INTERNAL_API_SECRET)
    return {
      ok: false,
      error:
        "INTERNAL_API_SECRET isn't set on this deployment, so no email can be scheduled.",
    };

  const db = getDb();
  const loc = (
    await db.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1)
  )[0];
  if (!loc) return { ok: false, error: "Location not found" };

  const rows = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .innerJoin(availabilities, eq(availabilities.id, bookings.availabilityId))
    .where(eligible(loc.id))
    .orderBy(availabilities.startsAt) // soonest tours first — they run out of time first
    .limit(MAX_PER_RUN);

  let armed = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const results = await Promise.all(
      rows.slice(i, i + CHUNK).map((r) =>
        notifyManualBookingEmails(r.id, {
          confirmation: false,
          reminders: true,
          review: false,
        }),
      ),
    );
    for (const ok of results) {
      if (ok) armed++;
      else failed++;
    }
  }

  const { pending: remaining } = await countImportedWithoutReminders(slug);

  await recordAudit({
    slug,
    action: "booking.reminders.arm_imported",
    summary: `Armed reminders for ${armed} imported booking(s)${failed ? `, ${failed} failed` : ""}`,
    payload: { armed, failed, remaining },
  });
  revalidatePath(`/locations/${slug}/settings/imported-reminders`);
  return { ok: true, armed, failed, remaining };
}
