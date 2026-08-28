import "server-only";
import { eq } from "drizzle-orm";
import {
  availabilities,
  bookingLines,
  bookings,
  customers,
  getDb,
  items,
  payments,
} from "@/lib/db";

/**
 * The `booking.created` payload, built from the committed booking.
 *
 * Why this exists: the dashboard's manual-booking path used to emit
 * `{ booking_id, source: "direct" }` — the same `event_type` as the booking app, with none of the
 * money. Two irreconcilable shapes behind one event name meant a receiver had to branch on
 * `source_surface`, and every operator-entered booking reached the cockpit as ZERO revenue. Phone and
 * walk-in bookings are a real share of the business, so the revenue truth the ad objective is measured
 * against was quietly missing all of them.
 *
 * Built by re-reading the booking rather than threading a dozen locals out of the transaction: it is
 * the only way to guarantee this stays identical to the booking app's payload
 * (`bookingsystem/src/lib/booking/after.ts`) instead of drifting apart a second time.
 *
 * KEEP IN SYNC with that file. If you add a field there, add it here.
 */
export async function buildBookingCreatedPayload(
  bookingId: string,
): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const b = (
    await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1)
  )[0];
  if (!b) return null;

  const [itemRows, slotRows, custRows, lines, payRows] = await Promise.all([
    db.select().from(items).where(eq(items.id, b.itemId)).limit(1),
    b.availabilityId
      ? db
          .select()
          .from(availabilities)
          .where(eq(availabilities.id, b.availabilityId))
          .limit(1)
      : Promise.resolve([]),
    b.customerId
      ? db.select().from(customers).where(eq(customers.id, b.customerId)).limit(1)
      : Promise.resolve([]),
    db.select().from(bookingLines).where(eq(bookingLines.bookingId, bookingId)),
    db.select().from(payments).where(eq(payments.bookingId, bookingId)).limit(1),
  ]);
  const item = itemRows[0];
  const slot = slotRows[0];
  const cust = custRows[0];
  const pay = payRows[0];

  return {
    booking_id: b.id,
    display_number: b.displayNumber,
    customer_id: b.customerId,
    anonymous_id: cust?.anonymousId ?? null,
    // Almost always null on this path — an operator taking a booking by phone had no ad click. Sent
    // anyway so the shape matches, and so a returning customer whose FIRST booking came from an ad
    // still carries that attribution.
    first_attribution_click_id: cust?.firstAttributionClickId ?? null,
    first_attribution_click_type: cust?.firstAttributionClickType ?? null,
    // The closing click, per booking rather than per customer. On THIS path it is null by definition:
    // an operator typed this booking in, so no ad closed it. Sent anyway so both senders emit one
    // shape — the receiver should never have to know which surface a booking came from to parse it.
    //
    // That distinction is itself a signal worth having downstream: a booking with a first-touch click
    // and no closing click is one an ad found and a human closed.
    last_attribution_click_id: b.lastAttributionClickId ?? null,
    last_attribution_click_type: b.lastAttributionClickType ?? null,
    tour_id: b.itemId,
    tour_display_name: item?.name ?? null,
    scheduled_at: slot?.startsAt?.toISOString() ?? null,
    party_size: lines.reduce((s, l) => s + l.quantity, 0),
    booking_lines: lines.map((l) => ({
      customer_type_id: l.customerTypeId,
      quantity: l.quantity,
      unit_price: l.unitPriceCents,
    })),
    subtotal: b.subtotalCents,
    tax: b.taxCents,
    platform_fee: b.platformFeeCents,
    total: b.totalCents,
    deposit_paid: b.depositPaidCents,
    balance_due: b.balanceDueCents,
    currency: "USD",
    stripe_payment_intent_id: pay?.stripePaymentIntentId ?? null,
    customer: {
      email: cust?.emailLower ?? null,
      phone_e164: cust?.phoneE164 ?? null,
      first_name: cust?.firstName ?? null,
      last_name: cust?.lastName ?? null,
    },
    // The one field the booking app cannot set: how this booking was taken. "direct" covers phone,
    // walk-in and operator-entered.
    source: "direct",
    // Provenance, so the receiver can defend itself rather than trusting the sender to have filtered.
    // Non-null means this booking came from another system (FareHarbor) and the brains already hold it.
    external_ref: b.externalRef ?? null,
  };
}
