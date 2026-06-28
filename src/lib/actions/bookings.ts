"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { bookingLines, bookings, getDb } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { emitEvent } from "@/lib/events/emit";
import type { Location } from "@/lib/db/schema";

const CHECK = ["not_yet", "checked_in", "no_show"] as const;
type Check = (typeof CHECK)[number];

type Result = { ok: boolean; error?: string };

async function emitLifecycle(
  location: Location,
  bookingId: string,
  eventType: string,
): Promise<void> {
  try {
    const db = getDb();
    const b = (
      await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
    )[0];
    if (!b) return;
    await emitEvent({
      event_type: eventType,
      location_id: location.id,
      source_surface: "dashboard",
      data: { booking_id: bookingId, display_number: b.displayNumber },
    });
  } catch (err) {
    console.error("emit lifecycle failed", err);
  }
}

function revalidate(slug: string, bookingId?: string) {
  revalidatePath(`/locations/${slug}/bookings`);
  revalidatePath(`/locations/${slug}/bookings/list`);
  if (bookingId) revalidatePath(`/locations/${slug}/bookings/${bookingId}`);
}

// Set check-in for ALL rider lines on a booking.
export async function setBookingCheckIn(
  slug: string,
  bookingId: string,
  status: string,
): Promise<Result> {
  if (!CHECK.includes(status as Check))
    return { ok: false, error: "Invalid status" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
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
    .update(bookingLines)
    .set({
      checkInStatus: status as Check,
      checkedInAt: status === "checked_in" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(bookingLines.bookingId, bookingId));

  await recordAudit({
    slug,
    action: `catalog.booking.checkin`,
    summary: `Set all riders to ${status.replace("_", " ")}`,
    payload: { bookingId, status },
  });
  if (status === "checked_in") await emitLifecycle(location, bookingId, "booking.checked_in");
  if (status === "no_show") await emitLifecycle(location, bookingId, "booking.no_show");
  revalidate(slug, bookingId);
  return { ok: true };
}

// Set check-in for a single rider line.
export async function setLineCheckIn(
  slug: string,
  lineId: string,
  status: string,
): Promise<Result> {
  if (!CHECK.includes(status as Check))
    return { ok: false, error: "Invalid status" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const ln = (
    await db
      .select({ id: bookingLines.id, bookingId: bookingLines.bookingId })
      .from(bookingLines)
      .innerJoin(bookings, eq(bookingLines.bookingId, bookings.id))
      .where(and(eq(bookingLines.id, lineId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!ln) return { ok: false, error: "Line not found" };

  await db
    .update(bookingLines)
    .set({
      checkInStatus: status as Check,
      checkedInAt: status === "checked_in" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(bookingLines.id, lineId));

  await recordAudit({
    slug,
    action: `catalog.booking.line_checkin`,
    summary: `Set a rider to ${status.replace("_", " ")}`,
    payload: { bookingId: ln.bookingId, status },
  });
  revalidate(slug, ln.bookingId);
  return { ok: true };
}
