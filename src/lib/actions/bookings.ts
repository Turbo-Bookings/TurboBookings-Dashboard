"use server";

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import {
  availabilities,
  availabilitySchedules,
  bookingHolds,
  bookingLines,
  bookingReschedules,
  bookings,
  getDb,
  items,
  paymentMethodsOnFile,
  payments,
  resourceRequirements,
  resources,
} from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import { getCancellationRefund } from "@/lib/booking/refund";
import { fixedRemaining, resourceRemaining, type ResourcePool } from "@/lib/booking/capacity";
import { withTxn } from "@/lib/db/txn";
import {
  captureHold as stripeCaptureHold,
  createManualHold,
  refundPayment,
  releaseHold as stripeReleaseHold,
} from "@/lib/stripe/payments";
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
  revalidatePath(`/locations/${slug}/manifest`);
  revalidatePath(`/locations/${slug}/bookings`);
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

// Cancel a booking + issue the policy-driven refund (full-or-nothing for the
// default policy). Frees capacity (active filter). Emits booking.cancelled.
export async function cancelBooking(
  slug: string,
  bookingId: string,
  reason: string,
): Promise<Result> {
  const deny = await denyIfCannot("refund");
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
  const deny = await denyIfCannot("refund");
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
  const deny = await denyIfCannot("refund");
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
  const deny = await denyIfCannot("refund");
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
  const deny = await denyIfCannot("manage_bookings");
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
  revalidate(slug, bookingId);
  return { ok: true };
}
