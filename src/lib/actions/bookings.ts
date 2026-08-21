"use server";

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import {
  availabilities,
  availabilitySchedules,
  bookingHolds,
  bookingLines,
  bookingReschedules,
  bookings,
  customerTypes,
  customers,
  getDb,
  itemCustomerTypes,
  items,
  paymentMethodsOnFile,
  payments,
  resourceRequirements,
  resources,
} from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { getBookingDetail } from "@/lib/data/bookings";
import { getTourBookingData } from "@/lib/actions/manualBooking";
import { denyIfCannot } from "@/lib/auth/roles";
import { getCancellationRefund, stripeRefundableCents } from "@/lib/booking/refund";
import { fixedRemaining, resourceRemaining, type ResourcePool } from "@/lib/booking/capacity";
import { withTxn } from "@/lib/db/txn";
import {
  captureHold as stripeCaptureHold,
  createManualHold,
  refundPayment,
  releaseHold as stripeReleaseHold,
} from "@/lib/stripe/payments";
import { emitEvent } from "@/lib/events/emit";
import {
  onBookingCancelled,
  onBookingRescheduled,
} from "@/lib/email/scheduledEmails";
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
  revalidatePath(`/locations/${slug}/manifest`);
  revalidatePath(`/locations/${slug}/bookings`);
  if (bookingId) revalidatePath(`/locations/${slug}/bookings/${bookingId}`);
}

/**
 * Internal note on a booking — sales writes it, check-in reads it.
 *
 * Until now `bookings.notes` could only be set at creation, and only by the
 * manual-booking form, so a booking taken online could never carry one and no
 * note could ever be corrected. That made the field invisible in practice: the
 * manifest rendered it behind a column that defaults to off.
 *
 * Deliberately INTERNAL. It must never reach the customer — not the
 * confirmation email, not the success page. Check that before surfacing it
 * anywhere new.
 *
 * One overwritable field rather than a thread: the audit log already records
 * who changed it and when, which is the part that matters when check-in is
 * deciding how much to trust a sentence. Revisit only if two people actually
 * start clobbering each other.
 */
export async function setBookingNote(
  slug: string,
  bookingId: string,
  note: string,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const b = (
    await db
      .select({ id: bookings.id, displayNumber: bookings.displayNumber, notes: bookings.notes })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };

  const next = note.trim().slice(0, 2000) || null;
  if (next === b.notes) return { ok: true };

  await db
    .update(bookings)
    .set({ notes: next, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId));

  await recordAudit({
    slug,
    action: "catalog.booking.note",
    summary: next
      ? `${b.notes ? "Updated" : "Added"} note on #${b.displayNumber}`
      : `Cleared note on #${b.displayNumber}`,
    // The previous text is kept so a clobbered note can be recovered — the
    // audit log is the only history this field has.
    payload: { bookingId, from: b.notes, to: next },
  });
  revalidate(slug, bookingId);
  return { ok: true };
}

// Set check-in for ALL vehicles on a booking (every line's units).
export async function setBookingCheckIn(
  slug: string,
  bookingId: string,
  status: string,
): Promise<Result> {
  const deny = await denyIfCannot("checkin", slug);
  if (deny) return { ok: false, error: deny };
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

  const set =
    status === "checked_in"
      ? { checkedInUnits: sql`${bookingLines.quantity}`, noShowUnits: 0, checkInStatus: "checked_in" as const, checkedInAt: new Date(), updatedAt: new Date() }
      : status === "no_show"
        ? { checkedInUnits: 0, noShowUnits: sql`${bookingLines.quantity}`, checkInStatus: "no_show" as const, checkedInAt: null, updatedAt: new Date() }
        : { checkedInUnits: 0, noShowUnits: 0, checkInStatus: "not_yet" as const, checkedInAt: null, updatedAt: new Date() };
  await db.update(bookingLines).set(set).where(eq(bookingLines.bookingId, bookingId));

  await recordAudit({
    slug,
    action: `catalog.booking.checkin`,
    summary: `Set all vehicles to ${status.replace("_", " ")}`,
    payload: { bookingId, status },
  });
  if (status === "checked_in") await emitLifecycle(location, bookingId, "booking.checked_in");
  if (status === "no_show") await emitLifecycle(location, bookingId, "booking.no_show");
  revalidate(slug, bookingId);
  return { ok: true };
}

// Set per-vehicle check-in counts on one line (checked-in + no-show ≤ quantity).
export async function setLineCheckInCounts(
  slug: string,
  lineId: string,
  checkedIn: number,
  noShow: number,
): Promise<Result> {
  const deny = await denyIfCannot("checkin", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const ln = (
    await db
      .select({ id: bookingLines.id, bookingId: bookingLines.bookingId, quantity: bookingLines.quantity })
      .from(bookingLines)
      .innerJoin(bookings, eq(bookingLines.bookingId, bookings.id))
      .where(and(eq(bookingLines.id, lineId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!ln) return { ok: false, error: "Line not found" };
  const c = Math.max(0, Math.floor(checkedIn));
  const n = Math.max(0, Math.floor(noShow));
  if (c + n > ln.quantity) return { ok: false, error: "Exceeds vehicles on this line" };

  const derived = c === ln.quantity ? "checked_in" : n === ln.quantity ? "no_show" : "not_yet";
  await db
    .update(bookingLines)
    .set({
      checkedInUnits: c,
      noShowUnits: n,
      checkInStatus: derived as Check,
      checkedInAt: c > 0 ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(bookingLines.id, lineId));

  await recordAudit({
    slug,
    action: `catalog.booking.line_checkin`,
    summary: `Vehicles: ${c} checked in, ${n} no-show`,
    payload: { bookingId: ln.bookingId, lineId, checkedIn: c, noShow: n },
  });
  if (c > 0) await emitLifecycle(location, ln.bookingId, "booking.checked_in");
  revalidate(slug, ln.bookingId);
  return { ok: true };
}

// Cancel a booking + issue the policy-driven refund (full-or-nothing for the
// default policy). Frees capacity (active filter). Emits booking.cancelled.
export async function cancelBooking(
  slug: string,
  bookingId: string,
  reason: string,
): Promise<Result> {
  const deny = await denyIfCannot("refund", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const b = (
    await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };
  if (b.status !== "active") return { ok: false, error: "Booking is not active" };

  const refund = await getCancellationRefund(location.id, bookingId);
  let remaining = refund.refundCents;
  if (remaining > 0) {
    const pays = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId));
    for (const p of pays) {
      if (remaining <= 0) break;
      const refundable = p.amountCents - p.refundedAmountCents;
      // Only Stripe payments are refundable here; non-Stripe (Groupon/OTA, cash)
      // are handled outside the platform.
      if (
        refundable <= 0 ||
        !p.stripePaymentIntentId ||
        (p.status !== "succeeded" && p.status !== "partially_refunded")
      )
        continue;
      const amt = Math.min(remaining, refundable);
      try {
        await refundPayment(p.stripePaymentIntentId, location.stripeAccountId, amt);
      } catch (err) {
        return {
          ok: false,
          error: `Refund failed: ${err instanceof Error ? err.message : "unknown"}`,
        };
      }
      const newRefunded = p.refundedAmountCents + amt;
      await db
        .update(payments)
        .set({
          refundedAmountCents: newRefunded,
          status: newRefunded >= p.amountCents ? "refunded" : "partially_refunded",
          updatedAt: new Date(),
        })
        .where(eq(payments.id, p.id));
      remaining -= amt;
    }
  }
  const refunded = refund.refundCents - remaining;

  await db
    .update(bookings)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancellationReason: reason || null,
      refundedCents: b.refundedCents + refunded,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId));

  await recordAudit({
    slug,
    action: "catalog.booking.cancel",
    summary: `Cancelled #${b.displayNumber}${refunded > 0 ? ` · refunded $${(refunded / 100).toFixed(2)}` : " · no refund"}`,
    payload: { bookingId, refundedCents: refunded, reason },
  });
  await emitLifecycle(location, bookingId, "booking.cancelled");
  await onBookingCancelled(bookingId);
  revalidate(slug, bookingId);
  return { ok: true };
}

/**
 * Refund an operator-chosen amount, overriding the cancellation policy.
 *
 * `cancelBooking` can only ever refund what the policy computes, which is
 * correct for a customer-initiated cancellation and useless for everything
 * else: a goodwill refund, a weather call, an operator error, a test booking.
 * Miami's policy is 5 days' notice, so a booking made and cancelled the same
 * day computed $0.00 and the dashboard offered no way to do the right thing —
 * the operator had to leave the product and refund inside Stripe, where our
 * database then knew nothing about it.
 *
 * Gated on `manage_platform` (admin+) rather than `refund` (director+). Cancelling
 * per policy is routine staff work; moving an arbitrary amount of money against
 * the policy is not, and the whole point of this action is that it ignores the
 * rule that normally bounds the number.
 *
 * Deliberately separate from cancelling. A refund and a cancellation are
 * different events — you can refund a customer who is still coming, and you can
 * cancel someone who is owed nothing — so `alsoCancel` is opt-in.
 */
export async function refundBookingOverride(
  slug: string,
  bookingId: string,
  amountCents: number,
  reason: string,
  alsoCancel: boolean,
): Promise<Result> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny };

  const reasonText = reason.trim();
  // An override leaves no policy trail to explain itself, so the reason IS the
  // record. Required, unlike on a policy cancellation.
  if (!reasonText) return { ok: false, error: "A reason is required for an override refund." };

  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const b = (
    await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };

  const amount = Math.round(amountCents);
  if (!Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Enter a refund amount greater than zero." };

  const pays = await db.select().from(payments).where(eq(payments.bookingId, bookingId));
  const eligible = pays.filter(
    (p) =>
      p.stripePaymentIntentId &&
      (p.status === "succeeded" || p.status === "partially_refunded") &&
      p.amountCents - p.refundedAmountCents > 0,
  );
  const refundable = stripeRefundableCents(pays);
  // Re-checked here rather than trusted from the form: Stripe would reject an
  // over-refund anyway, but only after we had already refunded earlier payments
  // in the loop, leaving a partial result behind.
  if (amount > refundable)
    return {
      ok: false,
      error: `Only $${(refundable / 100).toFixed(2)} is still refundable on this booking.`,
    };

  let remaining = amount;
  for (const p of eligible) {
    if (remaining <= 0) break;
    const amt = Math.min(remaining, p.amountCents - p.refundedAmountCents);
    try {
      await refundPayment(p.stripePaymentIntentId!, location.stripeAccountId, amt);
    } catch (err) {
      // Stop rather than continue: whatever already succeeded is recorded below,
      // so a partial refund is visible instead of silently double-attempted.
      const done = amount - remaining;
      if (done > 0)
        await db
          .update(bookings)
          .set({ refundedCents: b.refundedCents + done, updatedAt: new Date() })
          .where(eq(bookings.id, bookingId));
      return {
        ok: false,
        error: `Refund failed after $${(done / 100).toFixed(2)}: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      };
    }
    const newRefunded = p.refundedAmountCents + amt;
    await db
      .update(payments)
      .set({
        refundedAmountCents: newRefunded,
        status: newRefunded >= p.amountCents ? "refunded" : "partially_refunded",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, p.id));
    remaining -= amt;
  }
  const refunded = amount - remaining;

  await db
    .update(bookings)
    .set({
      refundedCents: b.refundedCents + refunded,
      ...(alsoCancel && b.status === "active"
        ? {
            status: "cancelled" as const,
            cancelledAt: new Date(),
            cancellationReason: reasonText,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId));

  await recordAudit({
    slug,
    action: "catalog.booking.refund_override",
    summary: `Override refund $${(refunded / 100).toFixed(2)} on #${b.displayNumber}${
      alsoCancel ? " · cancelled" : " · booking kept"
    } — ${reasonText}`,
    payload: { bookingId, refundedCents: refunded, reason: reasonText, alsoCancel },
  });

  // Only on an actual cancellation. Firing these for a goodwill refund would
  // tell the customer their booking was cancelled when it is still on.
  if (alsoCancel && b.status === "active") {
    await emitLifecycle(location, bookingId, "booking.cancelled");
    await onBookingCancelled(bookingId);
  }
  revalidate(slug, bookingId);
  return { ok: true };
}

// Place a manual security hold on the customer's card-on-file.
export async function placeHold(
  slug: string,
  bookingId: string,
  amountCents: number,
): Promise<Result> {
  if (!Number.isInteger(amountCents) || amountCents < 50)
    return { ok: false, error: "Enter a valid hold amount" };
  const deny = await denyIfCannot("refund", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const b = (
    await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };

  const pm = (
    await db
      .select()
      .from(paymentMethodsOnFile)
      .where(
        and(
          eq(paymentMethodsOnFile.customerId, b.customerId),
          eq(paymentMethodsOnFile.archived, false),
        ),
      )
      .orderBy(desc(paymentMethodsOnFile.createdAt))
      .limit(1)
  )[0];
  if (!pm) return { ok: false, error: "No card on file for this customer" };

  let pi;
  try {
    pi = await createManualHold({
      account: location.stripeAccountId,
      paymentMethodId: pm.stripePaymentMethodId,
      amountCents,
      metadata: { bookingId },
    });
  } catch (err) {
    return {
      ok: false,
      error: `Hold failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }

  await db.insert(bookingHolds).values({
    bookingId,
    paymentMethodOnFileId: pm.id,
    stripePaymentIntentId: pi.id,
    amountCents,
    status: "authorized",
  });
  await recordAudit({
    slug,
    action: "catalog.booking.hold_place",
    summary: `Placed $${(amountCents / 100).toFixed(2)} security hold`,
    payload: { bookingId },
  });
  revalidate(slug, bookingId);
  return { ok: true };
}

async function holdInLocation(holdId: string, locationId: string) {
  const db = getDb();
  return (
    await db
      .select({
        id: bookingHolds.id,
        bookingId: bookingHolds.bookingId,
        pi: bookingHolds.stripePaymentIntentId,
        status: bookingHolds.status,
        amountCents: bookingHolds.amountCents,
      })
      .from(bookingHolds)
      .innerJoin(bookings, eq(bookingHolds.bookingId, bookings.id))
      .where(and(eq(bookingHolds.id, holdId), eq(bookings.locationId, locationId)))
      .limit(1)
  )[0];
}

export async function captureHold(
  slug: string,
  holdId: string,
  amountCents?: number,
): Promise<Result> {
  const deny = await denyIfCannot("refund", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const h = await holdInLocation(holdId, location.id);
  if (!h) return { ok: false, error: "Hold not found" };
  if (h.status !== "authorized")
    return { ok: false, error: "Hold can no longer be captured" };
  const amt = amountCents ?? h.amountCents;
  try {
    await stripeCaptureHold(h.pi, location.stripeAccountId, amt);
  } catch (err) {
    return {
      ok: false,
      error: `Capture failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  const db = getDb();
  await db
    .update(bookingHolds)
    .set({
      status: "captured",
      capturedAmountCents: amt,
      capturedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(bookingHolds.id, holdId));
  await recordAudit({
    slug,
    action: "catalog.booking.hold_capture",
    summary: `Captured $${(amt / 100).toFixed(2)} from a security hold`,
    payload: { bookingId: h.bookingId },
  });
  revalidate(slug, h.bookingId);
  return { ok: true };
}

export async function releaseHold(
  slug: string,
  holdId: string,
): Promise<Result> {
  const deny = await denyIfCannot("refund", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const h = await holdInLocation(holdId, location.id);
  if (!h) return { ok: false, error: "Hold not found" };
  if (h.status !== "authorized")
    return { ok: false, error: "Hold can no longer be released" };
  try {
    await stripeReleaseHold(h.pi, location.stripeAccountId);
  } catch (err) {
    return {
      ok: false,
      error: `Release failed: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  const db = getDb();
  await db
    .update(bookingHolds)
    .set({ status: "released", releasedAt: new Date(), updatedAt: new Date() })
    .where(eq(bookingHolds.id, holdId));
  await recordAudit({
    slug,
    action: "catalog.booking.hold_release",
    summary: "Released a security hold",
    payload: { bookingId: h.bookingId },
  });
  revalidate(slug, h.bookingId);
  return { ok: true };
}

// Operator-only reschedule: move a booking to a new slot of the SAME tour,
// capacity-checked; logs booking_reschedules; an optional fee is added to the
// balance due at venue (not auto-charged in V1). Emits booking.rescheduled.
export async function rescheduleBooking(
  slug: string,
  bookingId: string,
  toAvailabilityId: string,
  feeCents: number,
  reason: string,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const fee = Number.isInteger(feeCents) && feeCents > 0 ? feeCents : 0;
  const db = getDb();
  const b = (
    await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };
  if (b.status !== "active") return { ok: false, error: "Booking is not active" };
  if (toAvailabilityId === b.availabilityId)
    return { ok: false, error: "Pick a different time" };

  const item = (
    await db.select().from(items).where(eq(items.id, b.itemId)).limit(1)
  )[0];
  if (!item) return { ok: false, error: "Tour not found" };

  const lineRows = await db
    .select({ q: bookingLines.quantity })
    .from(bookingLines)
    .where(eq(bookingLines.bookingId, bookingId));
  const partySize = lineRows.reduce((s, r) => s + r.q, 0);

  let performedBy: string | null = null;
  try {
    const { userId } = await auth();
    performedBy = userId ?? null;
  } catch {}

  try {
    await withTxn(async (tx) => {
      const slot = (
        await tx.select().from(availabilities).where(eq(availabilities.id, toAvailabilityId)).for("update")
      )[0];
      if (!slot) throw new Error("New time not found");
      if (slot.itemId !== b.itemId) throw new Error("That time is for a different tour");

      const bookedRows = await tx
        .select({ qty: bookingLines.quantity })
        .from(bookings)
        .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
        .where(and(eq(bookings.availabilityId, toAvailabilityId), eq(bookings.status, "active")));
      const booked = bookedRows.reduce((s, r) => s + r.qty, 0);

      let remaining: number;
      if (item.capacityMode === "fixed") {
        let base = slot.capacityOverride;
        if (base == null && slot.scheduleId) {
          const sc = (
            await tx.select({ c: availabilitySchedules.capacityPerSlot }).from(availabilitySchedules).where(eq(availabilitySchedules.id, slot.scheduleId)).limit(1)
          )[0];
          base = sc?.c ?? null;
        }
        remaining = fixedRemaining(base, booked);
      } else {
        const rr = await tx
          .select({ rr: resourceRequirements, r: resources })
          .from(resourceRequirements)
          .innerJoin(resources, eq(resourceRequirements.resourceId, resources.id))
          .where(eq(resourceRequirements.itemId, b.itemId));
        const byRes = new Map<string, { max: number; oos: number; maxQ: number }>();
        for (const { rr: req, r } of rr) {
          const cur = byRes.get(r.id);
          if (!cur) byRes.set(r.id, { max: r.maxConcurrentUses, oos: r.outOfServiceCount, maxQ: req.quantityConsumed });
          else cur.maxQ = Math.max(cur.maxQ, req.quantityConsumed);
        }
        remaining = resourceRemaining(
          [...byRes.values()].map<ResourcePool>((p) => ({ maxConcurrentUses: p.max, outOfServiceCount: p.oos, maxQuantityConsumed: p.maxQ, consumed: booked })),
        );
      }
      if (partySize > remaining) throw new Error("Not enough capacity at the new time");

      await tx
        .update(bookings)
        .set({
          availabilityId: toAvailabilityId,
          balanceDueCents: b.balanceDueCents + fee,
          totalCents: b.totalCents + fee,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, bookingId));
      await tx.insert(bookingReschedules).values({
        bookingId,
        fromAvailabilityId: b.availabilityId,
        toAvailabilityId,
        feeChargedCents: fee,
        performedByUserId: performedBy,
        reason: reason || null,
      });
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reschedule failed" };
  }

  await recordAudit({
    slug,
    action: "catalog.booking.reschedule",
    summary: `Rescheduled #${b.displayNumber}${fee > 0 ? ` · fee $${(fee / 100).toFixed(2)}` : ""}`,
    payload: { bookingId },
  });
  await emitLifecycle(location, bookingId, "booking.rescheduled");
  await onBookingRescheduled(bookingId, toAvailabilityId);
  revalidate(slug, bookingId);
  return { ok: true };
}

// ---------- Modal quick-actions ----------

async function lineWithBooking(lineId: string, locationId: string) {
  const db = getDb();
  return (
    await db
      .select({ line: bookingLines, booking: bookings })
      .from(bookingLines)
      .innerJoin(bookings, eq(bookingLines.bookingId, bookings.id))
      .where(and(eq(bookingLines.id, lineId), eq(bookings.locationId, locationId)))
      .limit(1)
  )[0];
}

// Add vehicles to an existing line (e.g. the guest took an extra ATV). Capacity-
// checked; the extra goes to the balance due at the venue (no online fee/tax).
export async function addVehicles(
  slug: string,
  lineId: string,
  qty: number,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "Invalid quantity" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const row = await lineWithBooking(lineId, location.id);
  if (!row) return { ok: false, error: "Line not found" };
  const { line, booking } = row;
  if (booking.status !== "active") return { ok: false, error: "Booking is not active" };
  const item = (await getDb().select().from(items).where(eq(items.id, booking.itemId)).limit(1))[0];
  if (!item) return { ok: false, error: "Tour not found" };

  try {
    await withTxn(async (tx) => {
      const slot = (
        await tx.select().from(availabilities).where(eq(availabilities.id, booking.availabilityId)).for("update")
      )[0];
      if (!slot) throw new Error("Slot not found");
      const bookedRows = await tx
        .select({ qty: bookingLines.quantity })
        .from(bookings)
        .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
        .where(and(eq(bookings.availabilityId, booking.availabilityId), eq(bookings.status, "active")));
      const booked = bookedRows.reduce((s, r) => s + r.qty, 0);
      let remaining: number;
      if (item.capacityMode === "fixed") {
        let base = slot.capacityOverride;
        if (base == null && slot.scheduleId) {
          const sc = (await tx.select({ c: availabilitySchedules.capacityPerSlot }).from(availabilitySchedules).where(eq(availabilitySchedules.id, slot.scheduleId)).limit(1))[0];
          base = sc?.c ?? null;
        }
        remaining = fixedRemaining(base, booked);
      } else {
        const rr = await tx.select({ rr: resourceRequirements, r: resources }).from(resourceRequirements).innerJoin(resources, eq(resourceRequirements.resourceId, resources.id)).where(eq(resourceRequirements.itemId, booking.itemId));
        const byRes = new Map<string, { max: number; oos: number; maxQ: number }>();
        for (const { rr: req, r } of rr) {
          const cur = byRes.get(r.id);
          if (!cur) byRes.set(r.id, { max: r.maxConcurrentUses, oos: r.outOfServiceCount, maxQ: req.quantityConsumed });
          else cur.maxQ = Math.max(cur.maxQ, req.quantityConsumed);
        }
        remaining = resourceRemaining([...byRes.values()].map<ResourcePool>((x) => ({ maxConcurrentUses: x.max, outOfServiceCount: x.oos, maxQuantityConsumed: x.maxQ, consumed: booked })));
      }
      if (qty > remaining) throw new Error("Not enough capacity in this slot");

      const delta = qty * line.unitPriceCents;
      await tx.update(bookingLines).set({ quantity: line.quantity + qty, updatedAt: new Date() }).where(eq(bookingLines.id, lineId));
      await tx
        .update(bookings)
        .set({
          subtotalCents: booking.subtotalCents + delta,
          totalCents: booking.totalCents + delta,
          balanceDueCents: booking.balanceDueCents + delta,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id));
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add vehicle" };
  }
  await recordAudit({ slug, action: "catalog.booking.add_vehicles", summary: `Added ${qty} vehicle(s)`, payload: { bookingId: booking.id, lineId, qty } });
  revalidate(slug, booking.id);
  return { ok: true };
}

// Add a rider of ANY customer type to an existing booking — even a type not on
// the original reservation (e.g. add a Double Rider to a Single-Rider booking).
// Capacity-checked like addVehicles; the extra rides on the balance due at the
// venue (no online fee/tax). If a line for that type already exists we bump its
// quantity rather than creating a duplicate line. Operators may add "hidden"
// (comp / affiliate) types too, since this is an operator-only surface.
export async function addLine(
  slug: string,
  bookingId: string,
  customerTypeId: string,
  qty: number,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "Invalid quantity" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const booking = (
    await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!booking) return { ok: false, error: "Booking not found" };
  if (booking.status !== "active") return { ok: false, error: "Booking is not active" };
  const item = (await db.select().from(items).where(eq(items.id, booking.itemId)).limit(1))[0];
  if (!item) return { ok: false, error: "Tour not found" };

  // The customer type must be offered on this tour; that row carries the price.
  const ict = (
    await db
      .select({ price: itemCustomerTypes.priceCents, sortOrder: itemCustomerTypes.sortOrder })
      .from(itemCustomerTypes)
      .where(and(eq(itemCustomerTypes.itemId, booking.itemId), eq(itemCustomerTypes.customerTypeId, customerTypeId)))
      .limit(1)
  )[0];
  if (!ict) return { ok: false, error: "That rider type isn't offered on this tour" };
  const unitPriceCents = ict.price;

  try {
    await withTxn(async (tx) => {
      const slot = (
        await tx.select().from(availabilities).where(eq(availabilities.id, booking.availabilityId)).for("update")
      )[0];
      if (!slot) throw new Error("Slot not found");
      const bookedRows = await tx
        .select({ qty: bookingLines.quantity })
        .from(bookings)
        .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
        .where(and(eq(bookings.availabilityId, booking.availabilityId), eq(bookings.status, "active")));
      const booked = bookedRows.reduce((s, r) => s + r.qty, 0);
      let remaining: number;
      if (item.capacityMode === "fixed") {
        let base = slot.capacityOverride;
        if (base == null && slot.scheduleId) {
          const sc = (await tx.select({ c: availabilitySchedules.capacityPerSlot }).from(availabilitySchedules).where(eq(availabilitySchedules.id, slot.scheduleId)).limit(1))[0];
          base = sc?.c ?? null;
        }
        remaining = fixedRemaining(base, booked);
      } else {
        const rr = await tx.select({ rr: resourceRequirements, r: resources }).from(resourceRequirements).innerJoin(resources, eq(resourceRequirements.resourceId, resources.id)).where(eq(resourceRequirements.itemId, booking.itemId));
        const byRes = new Map<string, { max: number; oos: number; maxQ: number }>();
        for (const { rr: req, r } of rr) {
          const cur = byRes.get(r.id);
          if (!cur) byRes.set(r.id, { max: r.maxConcurrentUses, oos: r.outOfServiceCount, maxQ: req.quantityConsumed });
          else cur.maxQ = Math.max(cur.maxQ, req.quantityConsumed);
        }
        remaining = resourceRemaining([...byRes.values()].map<ResourcePool>((x) => ({ maxConcurrentUses: x.max, outOfServiceCount: x.oos, maxQuantityConsumed: x.maxQ, consumed: booked })));
      }
      if (qty > remaining) throw new Error("Not enough capacity in this slot");

      // Reuse an existing line for the same type rather than duplicating it.
      const existing = (
        await tx
          .select()
          .from(bookingLines)
          .where(and(eq(bookingLines.bookingId, booking.id), eq(bookingLines.customerTypeId, customerTypeId)))
          .limit(1)
      )[0];
      if (existing) {
        await tx.update(bookingLines).set({ quantity: existing.quantity + qty, updatedAt: new Date() }).where(eq(bookingLines.id, existing.id));
      } else {
        await tx.insert(bookingLines).values({
          bookingId: booking.id,
          customerTypeId,
          quantity: qty,
          unitPriceCents,
          sortOrder: ict.sortOrder,
        });
      }

      const delta = qty * unitPriceCents;
      await tx
        .update(bookings)
        .set({
          subtotalCents: booking.subtotalCents + delta,
          totalCents: booking.totalCents + delta,
          balanceDueCents: booking.balanceDueCents + delta,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id));
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add rider" };
  }
  await recordAudit({ slug, action: "catalog.booking.add_line", summary: `Added ${qty} rider(s)`, payload: { bookingId: booking.id, customerTypeId, qty } });
  revalidate(slug, booking.id);
  return { ok: true };
}

// Remove vehicles from a line (can't go below already checked-in/no-show units).
export async function removeVehicles(
  slug: string,
  lineId: string,
  qty: number,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "Invalid quantity" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const row = await lineWithBooking(lineId, location.id);
  if (!row) return { ok: false, error: "Line not found" };
  const { line, booking } = row;
  const floor = line.checkedInUnits + line.noShowUnits;
  const newQty = line.quantity - qty;
  if (newQty < floor) return { ok: false, error: "Can't remove checked-in / no-show vehicles" };
  const delta = qty * line.unitPriceCents;
  const db = getDb();
  if (newQty <= 0) await db.delete(bookingLines).where(eq(bookingLines.id, lineId));
  else await db.update(bookingLines).set({ quantity: newQty, updatedAt: new Date() }).where(eq(bookingLines.id, lineId));
  await db
    .update(bookings)
    .set({
      subtotalCents: Math.max(0, booking.subtotalCents - delta),
      totalCents: Math.max(0, booking.totalCents - delta),
      balanceDueCents: Math.max(0, booking.balanceDueCents - delta),
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, booking.id));
  await recordAudit({ slug, action: "catalog.booking.remove_vehicles", summary: `Removed ${qty} vehicle(s)`, payload: { bookingId: booking.id, lineId, qty } });
  revalidate(slug, booking.id);
  return { ok: true };
}

// Add a one-off expense (+) or discount (−) to a booking's total + balance.
export async function addBookingAdjustment(
  slug: string,
  bookingId: string,
  label: string,
  amountCents: number,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!Number.isInteger(amountCents) || amountCents === 0) return { ok: false, error: "Enter an amount" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const b = (await db.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id))).limit(1))[0];
  if (!b) return { ok: false, error: "Booking not found" };
  await db
    .update(bookings)
    .set({
      totalCents: Math.max(0, b.totalCents + amountCents),
      balanceDueCents: Math.max(0, b.balanceDueCents + amountCents),
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId));
  await recordAudit({ slug, action: "catalog.booking.adjustment", summary: `${amountCents > 0 ? "Expense" : "Discount"}: ${label || "adjustment"} ${(amountCents / 100).toFixed(2)}`, payload: { bookingId, label, amountCents } });
  revalidate(slug, bookingId);
  return { ok: true };
}

// Manually set the booking total → recompute balance.
export async function editBookingTotal(
  slug: string,
  bookingId: string,
  totalCents: number,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!Number.isInteger(totalCents) || totalCents < 0) return { ok: false, error: "Enter a valid total" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();
  const b = (await db.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id))).limit(1))[0];
  if (!b) return { ok: false, error: "Booking not found" };
  await db
    .update(bookings)
    .set({ totalCents, balanceDueCents: Math.max(0, totalCents - b.depositPaidCents), updatedAt: new Date() })
    .where(eq(bookings.id, bookingId));
  await recordAudit({ slug, action: "catalog.booking.edit_total", summary: `Total set to $${(totalCents / 100).toFixed(2)}`, payload: { bookingId, totalCents } });
  revalidate(slug, bookingId);
  return { ok: true };
}

// Queue a message to the customer (sent by the Railway brain once wired).
export async function requestCommunication(
  slug: string,
  bookingId: string,
  channel: "email" | "sms",
  body: string,
): Promise<Result> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!body.trim()) return { ok: false, error: "Enter a message" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  try {
    await emitEvent({
      event_type: "communication.requested",
      location_id: location.id,
      source_surface: "dashboard",
      data: { booking_id: bookingId, channel, body: body.trim() },
    });
  } catch (e) {
    console.error("communication emit failed", e);
  }
  await recordAudit({ slug, action: "catalog.booking.message", summary: `Queued ${channel} to customer`, payload: { bookingId, channel } });
  return { ok: true };
}

// ---------- Slot-level quick actions (Bookings-grid popover) ----------

// Queue a message to every active booking in a slot. audience "not_checked_in"
// limits to bookings that have no vehicles checked in yet. Sent by the Railway
// brain once wired — here we only enqueue one communication.requested per
// booking (twice for channel "both").
export async function messageSlotCustomers(
  slug: string,
  availabilityId: string,
  channel: "email" | "sms" | "both",
  audience: "all" | "not_checked_in",
  body: string,
): Promise<Result & { count?: number }> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!body.trim()) return { ok: false, error: "Enter a message" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const db = getDb();

  const rows = await db
    .select({
      id: bookings.id,
      checkedIn: sql<number>`coalesce(sum(${bookingLines.checkedInUnits}), 0)`,
    })
    .from(bookings)
    .leftJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.availabilityId, availabilityId),
        eq(bookings.locationId, location.id),
        eq(bookings.status, "active"),
      ),
    )
    .groupBy(bookings.id);

  const targets = rows
    .filter((r) => (audience === "not_checked_in" ? Number(r.checkedIn) === 0 : true))
    .map((r) => r.id);
  if (targets.length === 0)
    return { ok: false, error: "No customers match that audience" };

  const channels: ("email" | "sms")[] = channel === "both" ? ["email", "sms"] : [channel];
  for (const bookingId of targets) {
    for (const ch of channels) {
      try {
        await emitEvent({
          event_type: "communication.requested",
          location_id: location.id,
          source_surface: "dashboard",
          data: { booking_id: bookingId, channel: ch, body: body.trim() },
        });
      } catch (e) {
        console.error("slot communication emit failed", e);
      }
    }
  }

  await recordAudit({
    slug,
    action: "catalog.slot.message",
    summary: `Queued ${channel} to ${targets.length} customer${targets.length === 1 ? "" : "s"} in a slot`,
    payload: { availabilityId, channel, audience, count: targets.length },
  });
  return { ok: true, count: targets.length };
}

// Move every active booking out of one slot into another slot of the SAME tour,
// all-or-nothing (one transaction, combined capacity check). Logs a reschedule
// per booking and queues a "time changed" notice each. Leaves the (now empty)
// source slot in place for the operator to delete.
export async function moveSlotBookings(
  slug: string,
  fromAvailabilityId: string,
  toAvailabilityId: string,
): Promise<Result & { count?: number }> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (fromAvailabilityId === toAvailabilityId)
    return { ok: false, error: "Pick a different time" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };

  let performedBy: string | null = null;
  try {
    const { userId } = await auth();
    performedBy = userId ?? null;
  } catch {}

  const moved: string[] = [];
  try {
    await withTxn(async (tx) => {
      const target = (
        await tx.select().from(availabilities).where(eq(availabilities.id, toAvailabilityId)).for("update")
      )[0];
      if (!target) throw new Error("Target time not found");

      const group = await tx
        .select({ id: bookings.id, availabilityId: bookings.availabilityId })
        .from(bookings)
        .where(
          and(
            eq(bookings.availabilityId, fromAvailabilityId),
            eq(bookings.locationId, location.id),
            eq(bookings.status, "active"),
          ),
        );
      if (group.length === 0) throw new Error("No bookings to move");

      const item = (
        await tx.select().from(items).where(eq(items.id, target.itemId)).limit(1)
      )[0];
      if (!item) throw new Error("Tour not found");

      // Party size of the whole moving group.
      const groupIds = group.map((g) => g.id);
      const groupLines = await tx
        .select({ q: bookingLines.quantity })
        .from(bookingLines)
        .where(inArray(bookingLines.bookingId, groupIds));
      const groupSize = groupLines.reduce((s, r) => s + r.q, 0);

      // Capacity already consumed at the target (excludes the moving group,
      // which is still attached to the source slot).
      const bookedRows = await tx
        .select({ qty: bookingLines.quantity })
        .from(bookings)
        .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
        .where(and(eq(bookings.availabilityId, toAvailabilityId), eq(bookings.status, "active")));
      const booked = bookedRows.reduce((s, r) => s + r.qty, 0);

      let remaining: number;
      if (item.capacityMode === "fixed") {
        let base = target.capacityOverride;
        if (base == null && target.scheduleId) {
          const sc = (
            await tx.select({ c: availabilitySchedules.capacityPerSlot }).from(availabilitySchedules).where(eq(availabilitySchedules.id, target.scheduleId)).limit(1)
          )[0];
          base = sc?.c ?? null;
        }
        remaining = fixedRemaining(base, booked);
      } else {
        const rr = await tx
          .select({ rr: resourceRequirements, r: resources })
          .from(resourceRequirements)
          .innerJoin(resources, eq(resourceRequirements.resourceId, resources.id))
          .where(eq(resourceRequirements.itemId, item.id));
        const byRes = new Map<string, { max: number; oos: number; maxQ: number }>();
        for (const { rr: req, r } of rr) {
          const cur = byRes.get(r.id);
          if (!cur) byRes.set(r.id, { max: r.maxConcurrentUses, oos: r.outOfServiceCount, maxQ: req.quantityConsumed });
          else cur.maxQ = Math.max(cur.maxQ, req.quantityConsumed);
        }
        remaining = resourceRemaining(
          [...byRes.values()].map<ResourcePool>((p) => ({ maxConcurrentUses: p.max, outOfServiceCount: p.oos, maxQuantityConsumed: p.maxQ, consumed: booked })),
        );
      }
      if (groupSize > remaining) throw new Error("Not enough capacity at the target time");

      for (const g of group) {
        await tx
          .update(bookings)
          .set({ availabilityId: toAvailabilityId, updatedAt: new Date() })
          .where(eq(bookings.id, g.id));
        await tx.insert(bookingReschedules).values({
          bookingId: g.id,
          fromAvailabilityId: g.availabilityId,
          toAvailabilityId,
          feeChargedCents: 0,
          performedByUserId: performedBy,
          reason: "Slot eliminated — group move",
        });
        moved.push(g.id);
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Move failed" };
  }

  for (const bookingId of moved) {
    await emitLifecycle(location, bookingId, "booking.rescheduled");
    await onBookingRescheduled(bookingId, toAvailabilityId);
    try {
      await emitEvent({
        event_type: "communication.requested",
        location_id: location.id,
        source_surface: "dashboard",
        data: {
          booking_id: bookingId,
          channel: "email",
          body: "Your booking time has changed. Please check your confirmation for the new time.",
        },
      });
    } catch (e) {
      console.error("move notice emit failed", e);
    }
  }

  await recordAudit({
    slug,
    action: "catalog.slot.move",
    summary: `Moved ${moved.length} booking${moved.length === 1 ? "" : "s"} to another slot`,
    payload: { fromAvailabilityId, toAvailabilityId, count: moved.length },
  });
  revalidate(slug);
  revalidatePath(`/locations/${slug}/catalog/schedule/calendar`);
  return { ok: true, count: moved.length };
}

// Bundle everything the booking modal needs (called client-side on open).
export async function getBookingModalData(slug: string, bookingId: string) {
  const location = await getLocationBySlug(slug);
  if (!location) return null;
  const detail = await getBookingDetail(bookingId, location.id);
  if (!detail || !detail.booking) return null;
  const refund = await getCancellationRefund(location.id, bookingId);
  const tour =
    detail.booking.status === "active"
      ? await getTourBookingData(slug, detail.booking.itemId)
      : null;
  return {
    detail,
    refund,
    rescheduleSlots: tour && tour.ok ? tour.slots : [],
    // All rider types offered on this tour (incl. hidden/comp types), so an
    // operator can add one that isn't on the original reservation.
    riderTypes: tour && tour.ok ? tour.pricing : [],
    tz: location.timezone ?? "America/Chicago",
    hasCardOnFile: !!detail.cardOnFile,
    // Computed here rather than in the modal: refund.ts is server-only, and the
    // modal is a client component. Keeps the override's ceiling identical to
    // the one refundBookingOverride enforces.
    refundableCents: stripeRefundableCents(detail.payments),
  };
}

// Global booking lookup — by booking #, customer name, email, or phone.
export type BookingSearchHit = {
  id: string;
  displayNumber: string;
  customerName: string;
  itemName: string;
  startsAt: Date;
  status: string;
};
export async function searchBookings(slug: string, q: string): Promise<BookingSearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const location = await getLocationBySlug(slug);
  if (!location) return [];
  const like = `%${term}%`;
  const db = getDb();
  const rows = await db
    .select({
      id: bookings.id,
      displayNumber: bookings.displayNumber,
      first: customers.firstName,
      last: customers.lastName,
      itemName: items.name,
      startsAt: availabilities.startsAt,
      status: bookings.status,
    })
    .from(bookings)
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
    .innerJoin(items, eq(bookings.itemId, items.id))
    .where(
      and(
        eq(bookings.locationId, location.id),
        or(
          ilike(bookings.displayNumber, like),
          ilike(customers.firstName, like),
          ilike(customers.lastName, like),
          ilike(customers.emailLower, like),
          ilike(customers.phoneE164, like),
        ),
      ),
    )
    .orderBy(desc(availabilities.startsAt))
    .limit(10);
  return rows.map((r) => ({
    id: r.id,
    displayNumber: r.displayNumber,
    customerName: [r.first, r.last].filter(Boolean).join(" ") || "—",
    itemName: r.itemName,
    startsAt: r.startsAt,
    status: r.status,
  }));
}

// Most-recently-created bookings (by createdAt) for the quick-view panel —
// Name, tour date/time, total, tour type. Newest first.
export type RecentBookingHit = {
  id: string;
  displayNumber: string;
  customerName: string;
  itemName: string;
  startsAt: Date;
  /** When the booking was CREATED (distinct from startsAt, the tour time). */
  createdAt: Date;
  totalCents: number;
  status: string;
};
export async function listRecentBookings(slug: string): Promise<RecentBookingHit[]> {
  const location = await getLocationBySlug(slug);
  if (!location) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: bookings.id,
      displayNumber: bookings.displayNumber,
      first: customers.firstName,
      last: customers.lastName,
      itemName: items.name,
      startsAt: availabilities.startsAt,
      totalCents: bookings.totalCents,
      status: bookings.status,
      // bookings.created_at is `timestamp WITHOUT time zone` holding UTC. Left
      // alone, node-postgres parses it in the SERVER's local zone, so rendering
      // it in the location's timezone is only correct while the server happens
      // to run UTC.
      //
      // Rendered to an explicit ISO-8601 string with a Z suffix rather than
      // returned as a bare timestamp: `sql<Date>` is an unchecked ASSERTION, not
      // a conversion — the driver hands back a string, so the annotation
      // type-checked while the value crashed Intl.DateTimeFormat.format() at
      // runtime. A string the mapper parses itself is honest about what arrives.
      createdAtIso: sql<string>`to_char(${bookings.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(bookings)
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
    .innerJoin(items, eq(bookings.itemId, items.id))
    .where(eq(bookings.locationId, location.id))
    .orderBy(desc(bookings.createdAt))
    .limit(15);
  return rows.map((r) => ({
    id: r.id,
    displayNumber: r.displayNumber,
    customerName: [r.first, r.last].filter(Boolean).join(" ") || "—",
    itemName: r.itemName,
    startsAt: r.startsAt,
    createdAt: new Date(r.createdAtIso),
    totalCents: r.totalCents,
    status: r.status,
  }));
}
