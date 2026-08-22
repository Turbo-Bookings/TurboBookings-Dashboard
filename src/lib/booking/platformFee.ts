import "server-only";
import { and, desc, eq } from "drizzle-orm";
import {
  bookings,
  getDb,
  paymentMethodsOnFile,
  payments,
  type Location,
} from "@/lib/db";
import { chargeCardOnFile } from "@/lib/stripe/payments";
import { recordAudit } from "@/lib/audit";

/**
 * Keep the platform fee correct when a booking's value changes after checkout.
 *
 * ## Why this is needed
 *
 * The fee is 6% of the FULL booking subtotal, charged to the customer as part of the online payment
 * (`totalDueOnline = deposit + tax + fee`) and collected via `application_fee_amount` on that single
 * PaymentIntent. Once that charge settles the application fee is fixed forever.
 *
 * So any later increase in booking value — a cross-tour reschedule to a pricier tour, or an ATV added
 * at check-in — left the fee under-collected AND left `bookings.platform_fee_cents` stale.
 * `addVehicles` updated subtotal, total and balance due but never the fee.
 *
 * ## The ratchet
 *
 * The fee only ever goes UP. A downgrade or a removed ATV lowers what the customer owes at the venue
 * but does NOT claw back platform fee: that money was charged, disclosed and earned on the booking as
 * sold. Recomputing downward would hand back revenue on every schedule change and make the fee
 * depend on the order operations happen in.
 *
 * A refund is the one path that returns fee — see `refund_application_fee` in stripe/payments.ts.
 */

export type FeeSyncResult = {
  /** Fee stored on the booking after this call. */
  feeCents: number;
  /** How much extra was owed (0 when the value fell or was unchanged). */
  deltaCents: number;
  /** True when the delta was successfully charged to a saved card. */
  charged: boolean;
  /** Set when a delta was owed but could not be collected — surfaced, never silent. */
  uncollectedReason?: string;
};

/**
 * Recompute the fee for a new subtotal, ratcheting upward, and collect any increase from the
 * customer's saved card.
 *
 * Never throws. A failed card charge must not roll back the reschedule or the added vehicle — the
 * operator has already told the customer it is done. The shortfall is recorded in the audit log
 * instead, so it can be chased rather than lost.
 *
 * Call AFTER the transaction that changed the booking's subtotal has committed: it charges an
 * external system, and doing that inside a transaction risks taking money for a change that then
 * rolls back.
 */
export async function syncPlatformFee(
  location: Location,
  bookingId: string,
  newSubtotalCents: number,
  context: string,
): Promise<FeeSyncResult> {
  const db = getDb();
  const b = (
    await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
  )[0];
  if (!b) return { feeCents: 0, deltaCents: 0, charged: false, uncollectedReason: "Booking not found" };

  const bps = location.platformFeeBps ?? 0;
  const target = Math.round(Math.max(0, newSubtotalCents) * (bps / 10000));
  const current = b.platformFeeCents ?? 0;

  // The ratchet. Equal or lower target → nothing to do, and we keep what was charged.
  if (target <= current) {
    return { feeCents: current, deltaCents: 0, charged: false };
  }

  const delta = target - current;

  const pm = b.customerId
    ? (
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
      )[0]
    : undefined;

  let charged = false;
  let uncollectedReason: string | undefined;
  let intentId: string | null = null;

  if (!pm) {
    uncollectedReason = "No card on file — collect the platform fee difference manually.";
  } else {
    try {
      const pi = await chargeCardOnFile({
        account: location.stripeAccountId,
        paymentMethodId: pm.stripePaymentMethodId,
        amountCents: delta,
        description: `Booking #${b.displayNumber} — booking fee adjustment (${context})`,
        metadata: { booking_id: bookingId, kind: "platform_fee_topup", context },
      });
      intentId = pi.id;
      charged = pi.status === "succeeded";
      if (!charged) uncollectedReason = `Card charge ended in status "${pi.status}".`;
    } catch (err) {
      // Off-session charges fail for ordinary reasons — expired card, needs authentication, declined.
      uncollectedReason = err instanceof Error ? err.message : "Card charge failed";
    }
  }

  // The stored fee moves to the correct figure whether or not collection succeeded. It states what
  // the booking OWES; whether it has been received is the payments table's job.
  await db
    .update(bookings)
    .set({
      platformFeeCents: target,
      totalCents: newSubtotalCents + (b.taxCents ?? 0) + target,
      balanceDueCents:
        newSubtotalCents + (b.taxCents ?? 0) + target - (b.depositPaidCents ?? 0),
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId));

  if (charged && intentId) {
    await db.insert(payments).values({
      bookingId,
      paymentGateway: "stripe",
      stripePaymentIntentId: intentId,
      amountCents: delta,
      applicationFeeCents: delta,
      status: "succeeded",
      capturedAt: new Date(),
      paymentMethodType: "card",
      last4: pm?.last4 ?? null,
    });
  }

  await recordAudit({
    slug: location.slug,
    action: "catalog.booking.platform_fee_topup",
    summary:
      `#${b.displayNumber} fee $${(current / 100).toFixed(2)} → $${(target / 100).toFixed(2)} (${context})` +
      (charged
        ? ` · charged $${(delta / 100).toFixed(2)} to card`
        : ` · $${(delta / 100).toFixed(2)} NOT COLLECTED — ${uncollectedReason}`),
    payload: { bookingId, from: current, to: target, delta, charged, uncollectedReason, context },
  });

  return { feeCents: target, deltaCents: delta, charged, uncollectedReason };
}
