"use server";

import { and, eq, ne } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { bookings, customers, getDb, scheduledEmails } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import { phoneForStorage } from "@/lib/phone";
import { notifyManualBookingEmails } from "@/lib/booking/notifyManualBookingEmails";
import { revalidatePath } from "next/cache";

/**
 * Correct a customer's contact details.
 *
 * Until now there was NO update path against `customers` anywhere in either repo — every write was an
 * insert-or-upsert at booking time, and the upsert conflicts ON the email, so it structurally could
 * never change one. A customer who mistyped their address at checkout never got their confirmation
 * and staff had no way to fix it.
 *
 * Gated on `manage_bookings` (minimum role `director` = manager/staff), the same capability that
 * already guards notes, reschedule and add/remove vehicles.
 */

type Result = { ok: boolean; error?: string; repointed?: boolean };

export async function updateBookingCustomer(
  slug: string,
  bookingId: string,
  input: { email?: string; firstName?: string; lastName?: string; phone?: string },
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();

  // Scoped by locationId — this is what stops a director at one location editing another's data.
  const b = (
    await db
      .select({
        id: bookings.id,
        displayNumber: bookings.displayNumber,
        customerId: bookings.customerId,
      })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b?.customerId) return { ok: false, error: "Booking or customer not found" };

  const cur = (
    await db.select().from(customers).where(eq(customers.id, b.customerId)).limit(1)
  )[0];
  if (!cur) return { ok: false, error: "Customer not found" };

  const nextEmail = input.email?.trim().toLowerCase();
  const nextFirst = input.firstName?.trim() || null;
  const nextLast = input.lastName?.trim() || null;
  const nextPhone = phoneForStorage(input.phone);

  if (nextEmail !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nextEmail)) {
    return { ok: false, error: "That doesn't look like a valid email address." };
  }

  const emailChanged = nextEmail !== undefined && nextEmail !== cur.emailLower;

  // ── The collision case ──────────────────────────────────────────────────────────────────────
  // `customers` is UNIQUE on (location_id, email_lower). The scenario that prompted this feature —
  // a customer who mistyped their address — very often ALSO has a correct row already, because
  // people simply book again with the right address. A bare UPDATE would raise 23505 and surface as
  // an opaque server error.
  //
  // So: if the corrected address already belongs to someone at this location, move THIS booking onto
  // that customer instead of renaming this one. It is the same human, which is exactly what
  // dedup-by-email already assumes. Nothing is deleted and both rows survive.
  if (emailChanged) {
    const existing = (
      await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.locationId, location.id),
            eq(customers.emailLower, nextEmail!),
            ne(customers.id, cur.id),
          ),
        )
        .limit(1)
    )[0];

    if (existing) {
      await db
        .update(bookings)
        .set({ customerId: existing.id, updatedAt: new Date() })
        .where(eq(bookings.id, bookingId));
      await syncScheduledRecipients(bookingId, nextEmail!);

      await recordAudit({
        slug,
        action: "catalog.booking.customer_repointed",
        summary: `#${b.displayNumber} moved to existing customer ${nextEmail}`,
        // The old customer id is the undo: nothing was deleted, so this is reversible by hand.
        payload: { bookingId, fromCustomerId: cur.id, toCustomerId: existing.id, email: nextEmail },
      });
      revalidate(slug, bookingId);
      return { ok: true, repointed: true };
    }
  }

  const changes: Record<string, unknown> = {};
  if (emailChanged) changes.emailLower = nextEmail;
  if (input.firstName !== undefined && nextFirst !== cur.firstName) changes.firstName = nextFirst;
  if (input.lastName !== undefined && nextLast !== cur.lastName) changes.lastName = nextLast;
  if (input.phone !== undefined && nextPhone !== cur.phoneE164) changes.phoneE164 = nextPhone;

  if (Object.keys(changes).length === 0) return { ok: true };

  await db
    .update(customers)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(customers.id, cur.id));

  if (emailChanged) await syncScheduledRecipients(bookingId, nextEmail!);

  await recordAudit({
    slug,
    action: "catalog.booking.customer_edit",
    summary: `Updated customer on #${b.displayNumber} (${Object.keys(changes).join(", ")})`,
    // Old values kept so a bad edit is recoverable — the audit log is this data's only history.
    payload: {
      bookingId,
      customerId: cur.id,
      from: {
        emailLower: cur.emailLower,
        firstName: cur.firstName,
        lastName: cur.lastName,
        phoneE164: cur.phoneE164,
      },
      to: changes,
    },
  });
  revalidate(slug, bookingId);
  return { ok: true };
}

/**
 * Keep queued reminders' denormalized address in step.
 *
 * NOT load-bearing for delivery — the sender re-hydrates the customer at send time
 * (bookingsystem/src/lib/email/lifecycle.ts), so fixing the customer row already fixes queued mail.
 * Done anyway so the row does not sit there contradicting the customer it belongs to.
 */
async function syncScheduledRecipients(bookingId: string, email: string): Promise<void> {
  try {
    await getDb()
      .update(scheduledEmails)
      .set({ recipientEmail: email })
      .where(eq(scheduledEmails.bookingId, bookingId));
  } catch (err) {
    console.error("could not sync scheduled_emails recipient", { bookingId, err });
  }
}

function revalidate(slug: string, bookingId: string) {
  revalidatePath(`/locations/${slug}/bookings`);
  revalidatePath(`/locations/${slug}/bookings/${bookingId}`);
  revalidatePath(`/locations/${slug}/manifest`);
}


/**
 * Re-send the booking confirmation.
 *
 * Built on `notifyManualBookingEmails`, which is the ONLY path in this codebase that reaches Resend.
 *
 * ⚠️ Deliberately NOT built on `requestCommunication` / `emitEvent`. Those queue a
 * `communication.requested` envelope for a messaging brain that does not exist — zero consumers in
 * either repo. A resend button built that way would show a green tick, write a plausible audit entry,
 * and deliver nothing, forever. That is strictly worse than the bug it was meant to fix, because
 * staff would stop chasing it.
 *
 * Safe to call repeatedly: `confirmation` is not a `scheduled_email_type`, so no idempotency key is
 * involved, and `sendBookingConfirmation` re-reads the customer fresh — so it picks up a corrected
 * email automatically.
 */
export async function resendBookingConfirmation(
  slug: string,
  bookingId: string,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };

  // Fail before claiming success. `vercel env pull` returns sensitive values as empty strings, so
  // this is always unset on a dev machine — and the one thing worse than not sending the email is
  // telling staff it was sent. This is the same guard armImportedReminders carries, for the same
  // reason: an earlier version reported "317 reminders armed" while scheduling exactly zero.
  if (!process.env.INTERNAL_API_SECRET) {
    return {
      ok: false,
      error: "INTERNAL_API_SECRET isn't set on this deployment, so no email can be sent.",
    };
  }

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  const b = (
    await getDb()
      .select({ id: bookings.id, displayNumber: bookings.displayNumber, customerId: bookings.customerId })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };

  const cust = b.customerId
    ? (await getDb().select({ email: customers.emailLower }).from(customers).where(eq(customers.id, b.customerId)).limit(1))[0]
    : undefined;
  if (!cust?.email || cust.email.endsWith("@import.invalid")) {
    return { ok: false, error: "This booking has no real email address to send to." };
  }

  // Confirmation ONLY. Passing the default would also re-attempt reminders; they would no-op on their
  // idempotency keys, but silently re-running unrelated machinery is how surprises happen.
  const sent = await notifyManualBookingEmails(bookingId, {
    confirmation: true,
    reminders: false,
    review: false,
  });

  await recordAudit({
    slug,
    action: "catalog.booking.confirmation_resent",
    summary: sent
      ? `Re-sent confirmation for #${b.displayNumber} to ${cust.email}`
      : `Confirmation resend FAILED for #${b.displayNumber}`,
    payload: { bookingId, email: cust.email, sent },
  });

  // Propagate the boolean rather than swallowing it — see the guard above.
  if (!sent) {
    return { ok: false, error: "The booking app did not accept the request. Nothing was sent." };
  }
  return { ok: true };
}
