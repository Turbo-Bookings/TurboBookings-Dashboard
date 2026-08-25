"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { bookings, getDb, paymentMethodsOnFile, payments } from "@/lib/db";
import { withTxn } from "@/lib/db/txn";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import { getStripe, stripeConfigured } from "@/lib/stripe/client";
import { recordAudit } from "@/lib/audit";
import { quoteBalanceCharge, type BalanceQuoteView } from "@/lib/booking/balanceCharge";

/**
 * Take the remaining balance on a card, at the desk, through our own system.
 *
 * Until now the dashboard could only charge a card at the moment a booking was CREATED. A booking
 * that already existed showed "Balance at venue: $X" and offered nothing — so the venue collected it
 * on an outside terminal, which meant two things: a walk-in who paid by card produced no platform
 * fee at all, and any fee we had failed to top up could only be recovered by billing the operator
 * after the fact.
 *
 * Running that payment through here fixes both at the point of sale. The 6% comes off as the Stripe
 * application fee at the instant the money moves, so it never becomes something to chase.
 *
 * Groupon/OTA and cash walk-ins are untouched: this is only reached when someone chooses to pay by
 * card, which is exactly the line the fee rule draws.
 */

type LoadResult =
  | { ok: false; error: string }
  | {
      ok: true;
      location: NonNullable<Awaited<ReturnType<typeof getLocationBySlug>>>;
      booking: typeof bookings.$inferSelect;
      quote: ReturnType<typeof quoteBalanceCharge>;
    };

async function loadQuote(slug: string, bookingId: string): Promise<LoadResult> {
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const b = (
    await getDb()
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];
  if (!b) return { ok: false, error: "Booking not found" };

  // A Groupon/OTA reservation earns us nothing by agreement. Detected from the payment record rather
  // than assumed, so paying the remainder by card cannot quietly attract a 6% the deal never had.
  const grouponOta = !!(
    await getDb()
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(eq(payments.bookingId, bookingId), eq(payments.paymentMethodType, "groupon_ota")),
      )
      .limit(1)
  )[0];

  const quote = quoteBalanceCharge({
    subtotalCents: b.subtotalCents ?? 0,
    discountCents: b.discountCents ?? 0,
    taxCents: b.taxCents ?? 0,
    totalCents: b.totalCents ?? 0,
    balanceDueCents: b.balanceDueCents ?? 0,
    platformFeeCents: b.platformFeeCents ?? 0,
    platformFeeUncollectedCents: b.platformFeeUncollectedCents ?? 0,
    feeAlreadyResolved:
      !!b.platformFeeWrittenOffAt || !!b.platformFeeBilledToOperatorAt,
    platformFeeBps: location.platformFeeBps ?? 0,
    passedToCustomer: location.platformFeeMode === "passed_to_customer",
    grouponOta,
    importedBooking: !!b.externalRef?.startsWith("fh:"),
  });
  return { ok: true, location, booking: b, quote };
}

/** What the desk would charge, for display before anyone touches a card. */
export async function getBalanceQuote(
  slug: string,
  bookingId: string,
): Promise<BalanceQuoteView | { error: string }> {
  if (await denyIfCannot("collect_payment", slug)) return { error: "Not permitted" };
  const r = await loadQuote(slug, bookingId);
  if (!r.ok) return { error: r.error };
  const { booking: b, quote } = r;

  const reason =
    b.status === "cancelled"
      ? "This booking is cancelled."
      : quote.chargeCents <= 0
        ? "Nothing left to collect."
        : // Stripe's floor for a USD card charge. Below it the intent is rejected outright.
          quote.chargeCents < 50
          ? "Amount is below Stripe's 50¢ minimum."
          : !r.location.stripeAccountId
            ? "This location has no connected Stripe account."
            : undefined;

  return {
    ...quote,
    bookingId,
    displayNumber: b.displayNumber,
    balanceDueCents: b.balanceDueCents ?? 0,
    chargeable: !reason,
    reason,
  };
}

/** Create the PaymentIntent the desk confirms via Elements. */
export async function createBalanceIntent(
  slug: string,
  bookingId: string,
): Promise<
  { ok: true; clientSecret: string; stripeAccount: string; chargeCents: number } | { ok: false; error: string }
> {
  const deny = await denyIfCannot("collect_payment", slug);
  if (deny) return { ok: false, error: deny };
  if (!stripeConfigured()) return { ok: false, error: "Payments are not configured." };

  const r = await loadQuote(slug, bookingId);
  if (!r.ok) return { ok: false, error: r.error };
  const { location, booking: b, quote } = r;

  if (b.status === "cancelled") return { ok: false, error: "This booking is cancelled." };
  if (quote.chargeCents < 50) return { ok: false, error: "Nothing left to collect." };
  // Without a connected account the charge would land on the PLATFORM account with no application
  // fee — the operator's money in our balance. Refuse rather than misroute it.
  const connected = location.stripeAccountId;
  if (!connected) {
    return {
      ok: false,
      error:
        "This location has no connected Stripe account. Finish Stripe Connect onboarding under Integrations before charging a card.",
    };
  }

  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: quote.chargeCents,
        currency: "usd",
        // Card only, matching <Elements paymentMethodTypes>. Deferred-intent mode refuses to confirm
        // on a mismatch, and the wallet methods finish through a redirect that hangs the confirm
        // promise behind an overlay — the frozen button reps hit on the new-booking form.
        payment_method_types: ["card"],
        // Keeps the card usable for a later fee top-up, the same as checkout does.
        setup_future_usage: "off_session",
        application_fee_amount: quote.applicationFeeCents,
        description: `Booking #${b.displayNumber} — balance collected at the venue`,
        metadata: {
          location_id: location.id,
          booking_id: bookingId,
          kind: "venue_balance",
          // Read back when recording, rather than re-derived: by then the booking may have changed,
          // and the customer was charged on THESE numbers.
          fee_added_cents: String(quote.feeAddedCents),
        },
      },
      {
        stripeAccount: connected,
        // A double-click, or a retry after a network blip, must not mint a second intent and take a
        // second payment. Keyed on the amount so a genuinely different charge is still allowed.
        idempotencyKey: `balance:${bookingId}:${quote.chargeCents}`,
      },
    );
    return {
      ok: true,
      clientSecret: pi.client_secret as string,
      stripeAccount: connected,
      chargeCents: quote.chargeCents,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not start the payment." };
  }
}

/**
 * Persist a confirmed balance payment.
 *
 * Written to be safe to call twice: the money has already moved by the time this runs, so the failure
 * that matters is recording it twice, not recording it late.
 */
export async function recordBalancePayment(
  slug: string,
  bookingId: string,
  paymentIntentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("collect_payment", slug);
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

  // Already recorded — a retry, a double submit, or the page reopened. Not an error.
  const existing = (
    await db
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.stripePaymentIntentId, paymentIntentId))
      .limit(1)
  )[0];
  if (existing) return { ok: true };

  const opts = location.stripeAccountId
    ? { stripeAccount: location.stripeAccountId }
    : undefined;
  let pi;
  try {
    pi = await getStripe().paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["payment_method"] },
      opts,
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the payment." };
  }

  // `processing` counts as paid: the money has moved and Stripe will settle it. Treating it as a
  // failure is how a customer gets charged and told the payment failed.
  if (!["succeeded", "processing"].includes(pi.status)) {
    return { ok: false, error: `Payment did not complete (${pi.status}).` };
  }

  const paid = pi.amount_received || pi.amount;
  const appFee =
    typeof pi.application_fee_amount === "number" ? pi.application_fee_amount : 0;
  const feeAdded = Number(pi.metadata?.fee_added_cents ?? 0) || 0;
  const pm =
    pi.payment_method && typeof pi.payment_method !== "string" ? pi.payment_method : null;

  const newTotal = (b.totalCents ?? 0) + feeAdded;
  const depositPaid = (b.depositPaidCents ?? 0) + paid;

  // `getDb()` is the neon-HTTP client, which cannot run an interactive transaction — it would have
  // thrown at runtime, on a real payment, after the customer's card was already charged. The three
  // writes below must land together, so they go through the WebSocket pool like every other
  // transactional path in the app.
  await withTxn(async (tx) => {
    await tx
      .update(bookings)
      .set({
        totalCents: newTotal,
        depositPaidCents: depositPaid,
        balanceDueCents: Math.max(0, newTotal - depositPaid),
        // What we RECEIVED, consistent with the rest of the fee accounting.
        platformFeeCents: (b.platformFeeCents ?? 0) + appFee,
        // The application fee settles the outstanding shortfall first, so whatever it covers stops
        // being outstanding. Clamped: on a walk-in there was never a shortfall to reduce.
        platformFeeUncollectedCents: Math.max(0, (b.platformFeeUncollectedCents ?? 0) - appFee),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));

    await tx.insert(payments).values({
      bookingId,
      paymentGateway: "stripe",
      stripePaymentIntentId: pi.id,
      amountCents: paid,
      applicationFeeCents: appFee,
      status: "succeeded",
      capturedAt: new Date(),
      paymentMethodType: pm?.type ?? "card",
      last4: pm?.card?.last4 ?? null,
      kind: "venue_balance",
    });

    // Keep the method for any later adjustment, the same as checkout does. Wallets included — gating
    // this on `pm.card` is what left two thirds of customers with nothing to charge.
    if (pm && b.customerId) {
      await tx
        .insert(paymentMethodsOnFile)
        .values({
          customerId: b.customerId,
          addedFromBookingId: bookingId,
          stripePaymentMethodId: pm.id,
          brand: pm.card?.brand ?? pm.type ?? null,
          last4: pm.card?.last4 ?? null,
          expMonth: pm.card?.exp_month ?? null,
          expYear: pm.card?.exp_year ?? null,
        })
        .onConflictDoNothing();
    }
  });

  await recordAudit({
    slug,
    action: "catalog.booking.collect_balance",
    summary:
      `#${b.displayNumber} — collected $${(paid / 100).toFixed(2)} by card at the venue` +
      (appFee > 0 ? ` · $${(appFee / 100).toFixed(2)} booking fee taken` : "") +
      (feeAdded > 0 ? ` · $${(feeAdded / 100).toFixed(2)} fee added to the total` : ""),
    payload: { bookingId, paid, appFee, feeAdded, paymentIntentId: pi.id },
  });

  revalidatePath(`/locations/${slug}/bookings/${bookingId}`);
  return { ok: true };
}
