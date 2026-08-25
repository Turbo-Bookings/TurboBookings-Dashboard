/**
 * What to charge when the venue takes the remaining balance on a card.
 *
 * Kept as a pure function, separate from the Stripe and database work, because the arithmetic is the
 * part that can quietly be wrong: it decides what a customer is charged and how much of it is ours.
 * `quoteBalanceCharge` is exercised directly by `scripts/check-balance-charge.ts`.
 *
 * Four shapes have to come out right, and they pull in different directions:
 *
 *  A. **Walk-in booked as pay-at-venue, now paying by card.** No fee was ever priced in — it is only
 *     computed when the rep picks "card" (`lib/pricing/breakdown.ts`). Paying by card now should cost
 *     exactly what it would have cost had the card been taken up front, so the 6% is ADDED.
 *
 *  B. **Booking whose value rose after checkout.** The full 6% is already in the total, sitting inside
 *     the balance. Nothing may be added — it simply reaches us as the application fee rather than
 *     reaching the operator as cash.
 *
 *  C. **Groupon/OTA, and FareHarbor imports.** No fee may be introduced at all: one earns nothing by
 *     agreement, the other was priced by a company that is not us.
 *
 *  D. **A booking that grew and then shrank.** Our fee ratchets up and never back down, so what is
 *     owed can exceed 6% of the subtotal standing today.
 *
 * Hand-sorting these is exactly how a customer gets billed 6% twice, so nothing is special-cased at
 * the call site. Everything derives from ONE number — how much fee has already been applied to the
 * booking — and only the difference is topped up.
 */

export type BalanceQuoteInput = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  balanceDueCents: number;
  /** Platform fee actually RECEIVED so far. */
  platformFeeCents: number;
  /** Shortfall recorded when a top-up failed. */
  platformFeeUncollectedCents: number;
  /** Set once the shortfall has been written off or billed to the operator — then it is not ours to take again. */
  feeAlreadyResolved: boolean;
  platformFeeBps: number;
  /** When the operator absorbs the fee, the customer's total does not move; our cut still does. */
  passedToCustomer: boolean;
  /**
   * Groupon/OTA reservations earn us nothing by agreement, so paying the remainder by card must not
   * suddenly attract 6%. Without this the rule would hold at booking time and quietly break at the
   * desk, which is the worst place for it to break.
   */
  grouponOta: boolean;
  /**
   * Imported from FareHarbor at cutover. The customer agreed a price with a different company before
   * we existed; introducing our 6% when they settle up would re-price a booking that is not ours to
   * re-price. Simulated across live data this was 589 of the 594 bookings that would otherwise have
   * had the fee added — $8,800 of surprise charges at the desk.
   */
  importedBooking: boolean;
};

export type BalanceQuote = {
  /** Total the customer is charged now. */
  chargeCents: number;
  /** Portion of that charge which is ours (the Stripe application fee). */
  applicationFeeCents: number;
  /** How much the customer's total rises — 0 whenever the fee was already priced in. */
  feeAddedCents: number;
  /** Platform fee still outstanding on this booking, before clamping to the charge. */
  feeOwedCents: number;
  /** Fee already applied to this booking — 0 means none was ever priced in. Drives the desk wording. */
  feePricedCents: number;
  /** The booking's new total after this charge. */
  newTotalCents: number;
};

export function quoteBalanceCharge(i: BalanceQuoteInput): BalanceQuote {
  // The 6% is priced off the DISCOUNTED subtotal, matching `computeBooking` — the base the customer
  // was originally quoted on.
  const adjusted = Math.max(0, i.subtotalCents - i.discountCents);
  const target = Math.round(adjusted * (i.platformFeeBps / 10000));

  // How much fee has ALREADY been applied to this booking, whether or not we managed to collect it.
  //
  // This was first written as `total − (subtotal + tax)`, on the assumption that whatever was left
  // over must be the fee. Simulated against 400 live bookings, that assumption broke twice: on
  // htown #0323 the residue was $30.20 against a $10.20 fee, because a per-person venue fee also
  // sits in the total; on miami #0143 it came out NEGATIVE, because `subtotal_cents_override` lets a
  // total fall below its own subtotal. The booking already records the answer — no subtraction, and
  // nothing to break the next time another line item joins the total.
  const feePriced = i.platformFeeCents + i.platformFeeUncollectedCents;

  // The ratchet, which is a deliberate commercial rule: our fee never goes DOWN when a booking
  // shrinks. So what is owed is the larger of the current 6% and whatever has already been applied.
  // Recomputing from the current subtotal alone silently gave up $1.80 across two bookings that had
  // grown and then lost a vehicle.
  //
  // Two kinds of booking may never have a fee INTRODUCED at the desk: Groupon/OTA, which earns
  // nothing by agreement, and FareHarbor imports, which were priced by someone else. For both, the
  // ceiling is whatever was already applied — normally zero. Anything already owed is still owed;
  // what is forbidden is inventing a new charge against a price the customer already agreed.
  //
  // Expressed once, here, so no downstream branch can apply the fee while forgetting the exemption.
  const noNewFee = i.grouponOta || i.importedBooking;
  const owedTotal = noNewFee ? feePriced : Math.max(target, feePriced);

  // Already resolved elsewhere — written off, or billed onto the operator's invoice. Taking it from
  // the customer as well would collect the same money twice.
  const resolved = i.feeAlreadyResolved ? i.platformFeeUncollectedCents : 0;
  const feeOwed = Math.max(0, owedTotal - i.platformFeeCents - resolved);

  // Only ever ADD what was never priced in, and only when the customer bears the fee.
  const feeAddedCents = i.passedToCustomer ? Math.max(0, owedTotal - feePriced) : 0;

  const chargeCents = Math.max(0, i.balanceDueCents) + feeAddedCents;
  return {
    chargeCents,
    // Never let our cut exceed the charge — Stripe rejects that outright, and it would mean taking
    // more than the customer paid.
    applicationFeeCents: Math.min(feeOwed, chargeCents),
    feeAddedCents,
    feeOwedCents: feeOwed,
    feePricedCents: feePriced,
    newTotalCents: i.totalCents + feeAddedCents,
  };
}

/**
 * The quote as the desk sees it. Lives here rather than beside the server action because a
 * `"use server"` module may only export async functions.
 */
export type BalanceQuoteView = BalanceQuote & {
  bookingId: string;
  displayNumber: string;
  balanceDueCents: number;
  /** False when there is a concrete reason the desk cannot take this payment. */
  chargeable: boolean;
  reason?: string;
};
