import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  availabilities,
  bookings,
  customers,
  getDb,
  locations,
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
  /**
   * The booking's subtotal BEFORE the caller's change. Only consulted for imported bookings, where
   * the fee is owed on the increase rather than on the whole sale — see below. Omitting it on an
   * import means "nothing new was sold", which is the safe default.
   */
  previousSubtotalCents?: number,
): Promise<FeeSyncResult> {
  const db = getDb();
  const b = (
    await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
  )[0];
  if (!b) return { feeCents: 0, deltaCents: 0, charged: false, uncollectedReason: "Booking not found" };

  const bps = location.platformFeeBps ?? 0;
  const current = b.platformFeeCents ?? 0;

  // The fee is owed on what is newly SOLD, never on what the booking is worth.
  //
  // This used to charge 6% of the whole subtotal for anything that was not a FareHarbor import — and
  // that is wrong for exactly the same reasons the import case was, which is why the import case had
  // already been special-cased. Three ways it went wrong on live bookings:
  //
  //   * A walk-in or Groupon/OTA booking deliberately stores `platform_fee_cents = 0`
  //     (pricing/breakdown.ts charges the fee only when `paymentMethod === "card"`). Rescheduling one
  //     invented the entire 6% and, with no card on file, `newTotal = total + delta` put it on the
  //     customer's balance. 8 live bookings carried $156.60 of fee nobody had ever been quoted.
  //   * It read GROSS `subtotal_cents`, ignoring both `discount_cents` and `subtotal_cents_override`,
  //     while checkout computes the fee from the NET price (bookingsystem quote.ts). So every
  //     reschedule of a discounted booking charged 6% of the discount for a booking whose value had
  //     not changed.
  //   * Because `platform_fee_cents` only advances when the money is actually collected (see
  //     `feeForRecords` below), an uncollectable target was recomputed identically on the NEXT
  //     reschedule and charged again. Booking #0286 was hit twice, $45.60.
  //
  // Measuring the INCREASE fixes all three at once, and needs no knowledge of discounts, overrides or
  // payment method: a discount is in both subtotals and cancels; an override is in neither; a
  // same-price move is zero; and a genuinely uncollected fee cannot recur because the subtotal does
  // not move a second time. What remains chargeable is what it should always have been — a vehicle
  // added at the counter, or a move to a pricier tour.
  //
  // Omitting `previousSubtotalCents` means "nothing new was sold", which is the safe default.
  const increase = Math.max(0, newSubtotalCents - (previousSubtotalCents ?? newSubtotalCents));
  const target = current + Math.round(increase * (bps / 10000));

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
          // Prefer a real CARD. Now that wallets (Link, Cash App) are saved too, the newest method
          // may be one Stripe will not accept for an off-session charge or a manual-capture hold.
          // `last4` is populated only for cards, so it is the discriminator.
          .orderBy(sql`${paymentMethodsOnFile.last4} IS NULL`, desc(paymentMethodsOnFile.createdAt))
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

  // Two honest numbers instead of one optimistic one.
  //
  // `platform_fee_cents` only moves when the money actually arrives, so revenue reports read as
  // money RECEIVED. The shortfall goes to `platform_fee_uncollected_cents` where it can be seen,
  // retried or written off. Recording the full target regardless — the old behaviour — had every
  // revenue figure overstating by whatever could not be charged, $649.80 across 30 bookings by the
  // time it was noticed.
  //
  // The customer's own total and balance still use the FULL target: they agreed to the 6%, and what
  // they owe does not change because our collection failed.
  const feeForRecords = charged ? target : current;

  // ⚠️ THE DOUBLE-CHARGE. Balance due is `total − deposit_paid`, and `total` already contains the
  // full fee. So when the top-up succeeds, the delta must ALSO be added to `deposit_paid` — otherwise
  // the customer pays it once by card here and again in the balance they settle at the venue.
  //
  // Nobody was ever hit by this, purely because no top-up had ever succeeded. It would have started
  // firing the moment card coverage improved, which is exactly what the next change does.
  const depositPaid = (b.depositPaidCents ?? 0) + (charged ? delta : 0);
  // Adjust the total by the FEE delta. Do NOT recompute it from the subtotal.
  //
  // This read `newSubtotalCents + tax + target`, which silently overwrote whatever the total actually
  // was. Callers had already applied their own change correctly — `addVehicles` does
  // `totalCents: booking.totalCents + delta` — and this undid it, then destroyed anything else living
  // in the total that is not subtotal, tax or our fee:
  //
  //   * FareHarbor imports carry their gross total with the old system's tax inside it, so adding one
  //     ATV to a migrated booking deleted that tax from what the guest owed.
  //   * `subtotal_cents_override` lets an operator set a custom price; recomputing threw it away and
  //     put the rack rate back.
  //
  // It has already fired: all 16 bookings that have had something added at the desk now reconcile
  // exactly, including imports that should carry a residue. 609 imported and 69 custom-priced
  // bookings were exposed to it.
  //
  // `b` is re-read after the caller's transaction commits, so `b.totalCents` already includes their
  // change. Ours is the fee and nothing else.
  const newTotal = (b.totalCents ?? 0) + delta;

  // A FareHarbor import has no Stripe payment behind it and never will, so there is nothing to charge
  // and nothing to chase. Write the shortfall off in the same breath as recording it, rather than
  // parking it on a report as work somebody might do. Those rows were 21 of the first 27 and $612.00
  // of the first $649.80 — cutover residue drowning the six bookings that are genuinely ours.
  //
  // Written off is not erased: the amount stays on the booking, so what the cutover cost stays legible.
  const autoWriteOff =
    !charged && !b.platformFeeWrittenOffAt && !!b.externalRef?.startsWith("fh:");

  await db
    .update(bookings)
    .set({
      platformFeeCents: feeForRecords,
      platformFeeUncollectedCents: charged
        ? (b.platformFeeUncollectedCents ?? 0)
        : (b.platformFeeUncollectedCents ?? 0) + delta,
      totalCents: newTotal,
      depositPaidCents: depositPaid,
      // Falls by exactly the amount just taken from the card. The customer's TOTAL outlay is
      // unchanged either way — only which side of the counter it arrives on.
      balanceDueCents: newTotal - depositPaid,
      ...(autoWriteOff ? { platformFeeWrittenOffAt: new Date() } : {}),
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
      kind: "fee_topup",
    });
  }

  await recordAudit({
    slug: location.slug,
    action: "catalog.booking.platform_fee_topup",
    summary:
      `#${b.displayNumber} fee $${(current / 100).toFixed(2)} → $${(target / 100).toFixed(2)} (${context})` +
      (charged
        ? ` · charged $${(delta / 100).toFixed(2)} to card`
        : ` · $${(delta / 100).toFixed(2)} NOT COLLECTED — ${uncollectedReason}` +
          (autoWriteOff ? " · written off automatically (FareHarbor import)" : "")),
    payload: { bookingId, from: current, to: target, delta, charged, uncollectedReason, context },
  });

  return { feeCents: target, deltaCents: delta, charged, uncollectedReason };
}


export type UncollectedFee = {
  bookingId: string;
  displayNumber: string;
  slug: string;
  locationName: string;
  amountCents: number;
  customerEmail: string | null;
  /** A card exists AND the customer has not yet settled at the venue. Both must hold. */
  chaseable: boolean;
  /**
   * The tour has run, so the customer has already paid the balance — and our fee was inside it.
   * The money is with the operator, not lost, and must be billed back rather than charged again.
   */
  settledAtVenue: boolean;
  reason: string;
  createdAt: Date;
  tourStartsAt: Date | null;
};

/**
 * Every booking still owing platform fee we could not take.
 *
 * `chaseable` is the column that matters: a retry can only work when the customer has a saved card.
 *
 * FareHarbor-era imports are written off on sight (see `syncPlatformFee`) and so never reach this
 * list. That is deliberate: they were 21 of the first 27 rows, and a report where the real work is
 * outnumbered three to one by rows nobody can act on is a report nobody opens.
 *
 * What remains is bookings taken through our own system, where the fee rose after checkout and the
 * top-up did not land — either no card was saved, or the charge failed.
 */
export async function listUncollectedFees(slug?: string): Promise<UncollectedFee[]> {
  const db = getDb();
  const rows = await db
    .select({
      bookingId: bookings.id,
      displayNumber: bookings.displayNumber,
      slug: locations.slug,
      locationName: locations.brandDisplayName,
      amountCents: bookings.platformFeeUncollectedCents,
      externalRef: bookings.externalRef,
      customerEmail: customers.emailLower,
      customerId: bookings.customerId,
      createdAtIso: sql<string>`to_char(${bookings.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      hasCard: sql<boolean>`EXISTS (SELECT 1 FROM payment_methods_on_file p WHERE p.customer_id = ${bookings.customerId} AND NOT p.archived)`,
      tourStartsAt: availabilities.startsAt,
    })
    .from(bookings)
    .innerJoin(locations, eq(locations.id, bookings.locationId))
    .leftJoin(customers, eq(customers.id, bookings.customerId))
    .leftJoin(availabilities, eq(availabilities.id, bookings.availabilityId))
    .where(
      and(
        gt(bookings.platformFeeUncollectedCents, 0),
        isNull(bookings.platformFeeWrittenOffAt),
        isNull(bookings.platformFeeBilledToOperatorAt),
        ...(slug ? [eq(locations.slug, slug)] : []),
      ),
    )
    .orderBy(desc(bookings.platformFeeUncollectedCents));

  const now = Date.now();
  return rows.map((r) => {
    // The tour having run is the line that matters. Up to it, the fee is still inside a balance the
    // customer has not paid, so charging the card collects it and drops their balance by the same
    // amount. After it, the operator already took that balance in cash — charging now bills the same
    // money twice, to the wrong person.
    //
    // Absent a slot we assume settled, because the failure that costs the customer money is worse
    // than the one that costs us a click.
    const settledAtVenue = r.tourStartsAt ? r.tourStartsAt.getTime() < now : true;
    return {
      bookingId: r.bookingId,
      displayNumber: r.displayNumber,
      slug: r.slug,
      locationName: r.locationName ?? r.slug,
      amountCents: r.amountCents,
      customerEmail: r.customerEmail,
      chaseable: !!r.hasCard && !settledAtVenue,
      settledAtVenue,
      reason: settledAtVenue
        ? "Tour has run — the operator collected this in the venue balance"
        : r.hasCard
          ? "Card on file — a retry should work"
          : "No saved card — it will be collected with the balance at check-in",
      createdAt: new Date(r.createdAtIso),
      tourStartsAt: r.tourStartsAt ?? null,
    };
  });
}

/** Retry the charge for one booking. Only ever succeeds when a usable card is on file. */
export async function retryUncollectedFee(
  location: Location,
  bookingId: string,
): Promise<FeeSyncResult> {
  const b = (
    await getDb().select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
  )[0];
  if (!b) return { feeCents: 0, deltaCents: 0, charged: false, uncollectedReason: "Booking not found" };
  // Re-derive the target from the CURRENT subtotal rather than trusting the stored split, so a retry
  // after another change still lands on the right number.
  // Pass the real subtotal. This used to reconstruct one by dividing the ROUNDED fee back out
  // (`target * 10000 / bps`), which round-trips to within a rounding error of where it started — a
  // laundered number where the actual one was already in hand.
  return syncPlatformFee(location, bookingId, b.subtotalCents ?? 0, "manual retry");
}

/** Accept that an amount will never be recovered, so it stops showing as outstanding. */
export async function writeOffUncollectedFee(
  location: Location,
  bookingId: string,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const b = (
    await db
      .select({ displayNumber: bookings.displayNumber, amount: bookings.platformFeeUncollectedCents })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };

  // The amount is KEPT, not zeroed — writing off is an acknowledgement, not an erasure, and the
  // running total of what we have forgone is worth being able to see.
  await db
    .update(bookings)
    .set({ platformFeeWrittenOffAt: new Date(), updatedAt: new Date() })
    .where(eq(bookings.id, bookingId));

  await recordAudit({
    slug: location.slug,
    action: "catalog.booking.platform_fee_written_off",
    summary: `Wrote off $${(b.amount / 100).toFixed(2)} of platform fee on #${b.displayNumber}${note ? ` — ${note}` : ""}`,
    payload: { bookingId, amountCents: b.amount, note },
  });
  return { ok: true };
}
