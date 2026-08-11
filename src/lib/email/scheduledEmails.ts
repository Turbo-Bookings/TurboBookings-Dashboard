import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  availabilities,
  bookings,
  customers,
  getDb,
  scheduledEmails,
} from "@/lib/db";

// The dashboard doesn't send email itself — the bookingsystem app owns the
// Resend infra. Instead, operator actions (cancel/reschedule) write rows into
// the SHARED scheduled_emails table and the bookingsystem cron drains + sends
// them. Mirrors how both repos share outbound_event_queue.

type SchedType = (typeof scheduledEmails.type.enumValues)[number];

type BookingCtx = {
  locationId: string;
  email: string;
  startsAt: Date;
  endsAt: Date;
};

async function bookingContext(bookingId: string): Promise<BookingCtx | null> {
  const db = getDb();
  const row = (
    await db
      .select({
        locationId: bookings.locationId,
        email: customers.emailLower,
        startsAt: availabilities.startsAt,
        endsAt: availabilities.endsAt,
      })
      .from(bookings)
      .innerJoin(customers, eq(bookings.customerId, customers.id))
      .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
      .where(eq(bookings.id, bookingId))
      .limit(1)
  )[0];
  if (!row || !row.email) return null;
  return {
    locationId: row.locationId,
    email: row.email,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
  };
}

async function cancelPending(
  bookingId: string,
  types: SchedType[],
): Promise<void> {
  const db = getDb();
  await db
    .update(scheduledEmails)
    .set({ canceledAt: new Date() })
    .where(
      and(
        eq(scheduledEmails.bookingId, bookingId),
        inArray(scheduledEmails.type, types),
        isNull(scheduledEmails.sentAt),
        isNull(scheduledEmails.canceledAt),
      ),
    );
}

async function enqueue(params: {
  type: SchedType;
  locationId: string;
  bookingId: string;
  recipientEmail: string;
  scheduledAt: Date;
  idempotencyKey: string;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(scheduledEmails)
    .values({
      type: params.type,
      locationId: params.locationId,
      bookingId: params.bookingId,
      recipientEmail: params.recipientEmail,
      scheduledAt: params.scheduledAt,
      nextAttemptAt: params.scheduledAt,
      idempotencyKey: params.idempotencyKey,
    })
    .onConflictDoNothing({ target: scheduledEmails.idempotencyKey });
}

// Cancel/refund: stop pending reminders + review, send a cancellation email.
export async function onBookingCancelled(bookingId: string): Promise<void> {
  try {
    const ctx = await bookingContext(bookingId);
    if (!ctx) return;
    await cancelPending(bookingId, [
      "reminder_24h",
      "reminder_2h",
      "post_tour_review",
    ]);
    await enqueue({
      type: "cancellation",
      locationId: ctx.locationId,
      bookingId,
      recipientEmail: ctx.email,
      scheduledAt: new Date(),
      idempotencyKey: `cancellation:${bookingId}:${Date.now()}`,
    });
  } catch (err) {
    console.error("onBookingCancelled email scheduling failed", err);
  }
}

// Reschedule: cancel stale reminders/review, re-arm them off the new slot, and
// send a reschedule confirmation. Call AFTER the booking now points at the new
// availability.
export async function onBookingRescheduled(
  bookingId: string,
  newAvailabilityId: string,
): Promise<void> {
  try {
    const ctx = await bookingContext(bookingId);
    if (!ctx) return;
    await cancelPending(bookingId, [
      "reminder_24h",
      "reminder_2h",
      "post_tour_review",
    ]);

    const now = Date.now();
    const startMs = ctx.startsAt.getTime();
    const suffix = `r${newAvailabilityId}`;
    const reminder24 = new Date(startMs - 24 * 60 * 60_000);
    const reminder2 = new Date(startMs - 2 * 60 * 60_000);
    if (reminder24.getTime() > now) {
      await enqueue({
        type: "reminder_24h",
        locationId: ctx.locationId,
        bookingId,
        recipientEmail: ctx.email,
        scheduledAt: reminder24,
        idempotencyKey: `reminder_24h:${bookingId}:${suffix}`,
      });
    }
    if (reminder2.getTime() > now) {
      await enqueue({
        type: "reminder_2h",
        locationId: ctx.locationId,
        bookingId,
        recipientEmail: ctx.email,
        scheduledAt: reminder2,
        idempotencyKey: `reminder_2h:${bookingId}:${suffix}`,
      });
    }
    await enqueue({
      type: "post_tour_review",
      locationId: ctx.locationId,
      bookingId,
      recipientEmail: ctx.email,
      scheduledAt: new Date(ctx.endsAt.getTime() + 3 * 60 * 60_000),
      idempotencyKey: `post_tour_review:${bookingId}:${suffix}`,
    });
    await enqueue({
      type: "reschedule",
      locationId: ctx.locationId,
      bookingId,
      recipientEmail: ctx.email,
      scheduledAt: new Date(),
      idempotencyKey: `reschedule:${bookingId}:${Date.now()}`,
    });
  } catch (err) {
    console.error("onBookingRescheduled email scheduling failed", err);
  }
}
