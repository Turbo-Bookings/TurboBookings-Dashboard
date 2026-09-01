"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { bookingComments, bookings, getDb } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/audit";
import { labelFor, resolveUserLabels } from "@/lib/users";

/**
 * Free-text comments on a booking — any booking, any date, by any member of staff.
 *
 * Writing is gated on `comment` (basic_user+) rather than `manage_bookings` (director+). That gate is
 * the whole reported bug: nothing in the code has ever looked at the tour date, so "we can't comment
 * on past reservations" was front-line staff seeing every note read-only, on past and future bookings
 * alike. Reading is gated on `checkin` — anyone who can open the booking can read its thread.
 *
 * Append-only. No update path, no `updatedAt`, matching `booking_followups`: an edited comment is a
 * record of nothing, and the trail is the point.
 */

export type BookingCommentEntry = {
  id: string;
  body: string;
  createdAt: Date;
  byName: string;
};

const MAX_BODY = 2000;

export async function addBookingComment(
  slug: string,
  bookingId: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("comment", slug);
  if (deny) return { ok: false, error: deny };

  const text = body.trim().slice(0, MAX_BODY);
  if (!text) return { ok: false, error: "Write something first." };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const db = getDb();
  // Scoped to the location, so a booking id from another client cannot be commented on. Every
  // export of a `"use server"` file is a POST endpoint and the caller supplies both ids.
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

  await db.insert(bookingComments).values({
    bookingId,
    locationId: location.id,
    body: text,
    userId,
  });

  await recordAudit({
    slug,
    action: "catalog.booking.comment",
    summary: `#${b.displayNumber} — comment added`,
    payload: { bookingId, length: text.length },
  });

  revalidatePath(`/locations/${slug}/bookings/${bookingId}`);
  revalidatePath(`/locations/${slug}/reports/no-shows`);
  return { ok: true };
}

/** The whole thread for one booking, newest first. */
export async function listBookingComments(
  slug: string,
  bookingId: string,
): Promise<BookingCommentEntry[]> {
  if (await denyIfCannot("checkin", slug)) return [];
  const location = await getLocationBySlug(slug);
  if (!location) return [];

  const rows = await getDb()
    .select({
      id: bookingComments.id,
      body: bookingComments.body,
      createdAt: bookingComments.createdAt,
      userId: bookingComments.userId,
    })
    .from(bookingComments)
    .innerJoin(bookings, eq(bookings.id, bookingComments.bookingId))
    .where(
      and(
        eq(bookingComments.bookingId, bookingId),
        eq(bookings.locationId, location.id),
      ),
    )
    .orderBy(desc(bookingComments.createdAt));

  // One batched Clerk lookup for the whole thread, the same way the reschedules report does it.
  // Showing WHO said something is most of the value of a shared thread.
  const actors = await resolveUserLabels(rows.map((r) => r.userId));
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    byName: labelFor(actors, r.userId).name,
  }));
}
