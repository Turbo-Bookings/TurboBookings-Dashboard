import "server-only";
import { and, desc, eq } from "drizzle-orm";
import {
  availabilities,
  bookings,
  cancellationPolicies,
  cancellationPolicyRules,
  getDb,
  locations,
  payments,
} from "@/lib/db";

// Compute the refund due if a booking is cancelled now, per its location's
// cancellation policy (grace period → 100%; otherwise the best rule whose
// hours-before-start threshold is met; else 0%). V1 = per-policy %, which for
// the default 24h/100% policy is full-or-nothing; sliding-scale tiers naturally
// yield partial. Operator-initiated ad-hoc partial refunds are V1.5.
export type RefundPreview = {
  paidRefundableCents: number;
  pctBps: number;
  refundCents: number;
  label: string;
};

export async function getCancellationRefund(
  locationId: string,
  bookingId: string,
): Promise<RefundPreview> {
  const db = getDb();
  const booking = (
    await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, locationId)))
      .limit(1)
  )[0];
  if (!booking)
    return { paidRefundableCents: 0, pctBps: 0, refundCents: 0, label: "—" };

  const pays = await db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, bookingId));
  const paidRefundable = pays
    .filter((p) => p.status === "succeeded" || p.status === "partially_refunded")
    .reduce((s, p) => s + (p.amountCents - p.refundedAmountCents), 0);
  if (paidRefundable <= 0)
    return { paidRefundableCents: 0, pctBps: 0, refundCents: 0, label: "Nothing to refund" };

  const slot = (
    await db
      .select({ startsAt: availabilities.startsAt })
      .from(availabilities)
      .where(eq(availabilities.id, booking.availabilityId))
      .limit(1)
  )[0];
  const loc = (
    await db.select().from(locations).where(eq(locations.id, locationId)).limit(1)
  )[0];

  const policy = loc?.cancellationPolicyId
    ? (
        await db
          .select()
          .from(cancellationPolicies)
          .where(eq(cancellationPolicies.id, loc.cancellationPolicyId))
          .limit(1)
      )[0]
    : null;

  const now = Date.now();
  // Grace period after booking creation → always full refund.
  const graceMs = (policy?.gracePeriodMinutes ?? 0) * 60_000;
  if (booking.createdAt.getTime() + graceMs >= now) {
    return {
      paidRefundableCents: paidRefundable,
      pctBps: 10000,
      refundCents: paidRefundable,
      label: "Full refund (within grace period)",
    };
  }
  if (!policy || !slot) {
    return { paidRefundableCents: paidRefundable, pctBps: 0, refundCents: 0, label: "No refund (no policy)" };
  }

  const rules = await db
    .select()
    .from(cancellationPolicyRules)
    .where(eq(cancellationPolicyRules.policyId, policy.id))
    .orderBy(desc(cancellationPolicyRules.hoursBeforeStart));
  const hoursBefore = (slot.startsAt.getTime() - now) / 3_600_000;
  let pctBps = 0;
  for (const r of rules) {
    if (hoursBefore >= r.hoursBeforeStart) {
      pctBps = r.refundPctBps;
      break;
    }
  }
  const refundCents = Math.round((paidRefundable * pctBps) / 10000);
  return {
    paidRefundableCents: paidRefundable,
    pctBps,
    refundCents,
    label:
      pctBps > 0
        ? `${(pctBps / 100).toFixed(0)}% refund per policy`
        : "No refund (outside the cancellation window)",
  };
}
