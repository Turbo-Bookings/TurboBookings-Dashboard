"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { bookingFollowups, bookings, getDb, noShowCases } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/audit";
import { FOLLOWUP_STATUSES, type FollowupStatus } from "@/lib/booking/followupStatus";
import {
  NO_SHOW_CLOSE_REASONS,
  type NoShowCloseReason,
} from "@/lib/booking/noShowCase";
import { labelFor, resolveUserLabels } from "@/lib/users";

/**
 * Outreach on a no-show, recorded one attempt at a time.
 *
 * Append-only by design — see the note on the table. `addFollowUp` inserts and never updates, so
 * "left voicemail, then no answer, then rescheduled" survives as three facts instead of collapsing
 * into whatever somebody typed last.
 *
 * Gated on `manage_bookings` rather than `checkin`: chasing a customer who did not turn up is a sales
 * act, not a desk act, and the people doing it are the ones who can also rebook them.
 */

export type FollowupEntry = {
  id: string;
  status: FollowupStatus;
  note: string | null;
  createdAt: Date;
  byName: string;
};

export async function addFollowUp(
  slug: string,
  bookingId: string,
  status: string,
  note: string,
  /**
   * Optional occurrence + due date, so logging a call and promising a callback is one action rather
   * than two. Passing `forStartsAt` without `dueAtIso` clears any existing commitment.
   */
  schedule?: { forStartsAt: string; dueAtIso: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!FOLLOWUP_STATUSES.some((s) => s.key === status)) {
    return { ok: false, error: "Pick an outcome." };
  }
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const db = getDb();
  // Scoped to the location, so a booking id from elsewhere cannot have notes attached to it.
  const b = (
    await db
      .select({ id: bookings.id, displayNumber: bookings.displayNumber })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };

  const { auth } = await import("@clerk/nextjs/server");
  let userId: string | null = null;
  try {
    userId = (await auth()).userId ?? null;
  } catch {
    /* system-initiated; recorded without an actor rather than refused */
  }

  await db.insert(bookingFollowups).values({
    bookingId,
    locationId: location.id,
    status: status as FollowupStatus,
    note: note.trim().slice(0, 2000) || null,
    userId,
  });

  await recordAudit({
    slug,
    action: "catalog.booking.followup",
    summary: `#${b.displayNumber} — follow-up logged: ${status.replace(/_/g, " ")}`,
    payload: { bookingId, status },
  });

  if (schedule) {
    await upsertCase(slug, bookingId, schedule.forStartsAt, {
      nextFollowUpAt: schedule.dueAtIso ? new Date(schedule.dueAtIso) : null,
    });
  }

  revalidatePath(`/locations/${slug}/reports/no-shows`);
  revalidatePath(`/locations/${slug}/bookings/${bookingId}`);
  return { ok: true };
}

/** The whole trail for one booking, oldest last. */
export async function listFollowUps(
  slug: string,
  bookingId: string,
): Promise<FollowupEntry[]> {
  if (await denyIfCannot("checkin", slug)) return [];
  const location = await getLocationBySlug(slug);
  if (!location) return [];

  const rows = await getDb()
    .select()
    .from(bookingFollowups)
    .where(
      and(
        eq(bookingFollowups.bookingId, bookingId),
        eq(bookingFollowups.locationId, location.id),
      ),
    )
    .orderBy(desc(bookingFollowups.createdAt));

  const actors = await resolveUserLabels(rows.map((r) => r.userId));
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    note: r.note,
    createdAt: r.createdAt,
    byName: labelFor(actors, r.userId).name,
  }));
}

// ------------------------------------------------------------ case workflow

/**
 * The two things about a no-show case that cannot be derived: when the rep will try again, and
 * whether they have given up on it.
 *
 * Everything else — attempts, refusal, won-back — is computed from the follow-up log and the
 * reschedule snapshots by `resolveCase`. Storing those would create a second copy that drifts, which
 * is how the no-shows report came to disagree with the reschedules report in the first place.
 *
 * Rows are upserted on (booking_id, for_starts_at): a booking that missed twice is two cases, and a
 * booking nobody has touched has no row at all.
 */
async function upsertCase(
  slug: string,
  bookingId: string,
  forStartsAt: string,
  patch: {
    nextFollowUpAt?: Date | null;
    closedAt?: Date | null;
    closedReason?: NoShowCloseReason | null;
    closedByUserId?: string | null;
    reopenedAt?: Date | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const forAt = new Date(forStartsAt);
  if (Number.isNaN(forAt.getTime())) return { ok: false, error: "Bad occurrence" };

  const db = getDb();
  const b = (
    await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };

  await db
    .insert(noShowCases)
    .values({
      bookingId,
      locationId: location.id,
      forStartsAt: forAt,
      ...patch,
    })
    .onConflictDoUpdate({
      target: [noShowCases.bookingId, noShowCases.forStartsAt],
      set: { ...patch, updatedAt: new Date() },
    });

  revalidatePath(`/locations/${slug}/reports/no-shows`);
  revalidatePath(`/locations/${slug}/bookings/${bookingId}`);
  return { ok: true };
}

/** "Try again on…" — the commitment that puts a case in the overdue or due-today bucket. */
export async function snoozeNoShowCase(
  slug: string,
  bookingId: string,
  forStartsAt: string,
  dueAtIso: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const due = dueAtIso ? new Date(dueAtIso) : null;
  if (dueAtIso && Number.isNaN(due!.getTime()))
    return { ok: false, error: "Pick a date." };
  return upsertCase(slug, bookingId, forStartsAt, { nextFollowUpAt: due });
}

/**
 * A rep closing a case by hand.
 *
 * Automatic closures — won back, refused, three attempts — are NOT written here. They are derived,
 * so they cannot go stale and cannot be contradicted by a later stray follow-up.
 */
export async function closeNoShowCase(
  slug: string,
  bookingId: string,
  forStartsAt: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!NO_SHOW_CLOSE_REASONS.some((r) => r.key === reason))
    return { ok: false, error: "Pick a reason." };
  let userId: string | null = null;
  try {
    const { auth } = await import("@clerk/nextjs/server");
    userId = (await auth()).userId ?? null;
  } catch {}
  return upsertCase(slug, bookingId, forStartsAt, {
    closedAt: new Date(),
    closedReason: reason as NoShowCloseReason,
    closedByUserId: userId,
  });
}

/**
 * Put a case back in the queue.
 *
 * `reopenedAt` is the one piece of state a pure function cannot derive: a case closed by three
 * attempts still HAS three attempts on file, so without a marker it would auto-close again the
 * instant it rendered. Attempts and refusals are counted from this timestamp onward.
 */
export async function reopenNoShowCase(
  slug: string,
  bookingId: string,
  forStartsAt: string,
): Promise<{ ok: boolean; error?: string }> {
  return upsertCase(slug, bookingId, forStartsAt, {
    reopenedAt: new Date(),
    closedAt: null,
    closedReason: null,
    closedByUserId: null,
    nextFollowUpAt: null,
  });
}
