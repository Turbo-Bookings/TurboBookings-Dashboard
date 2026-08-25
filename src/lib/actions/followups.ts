"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { bookingFollowups, bookings, getDb } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/audit";
import { FOLLOWUP_STATUSES, type FollowupStatus } from "@/lib/booking/followupStatus";
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
