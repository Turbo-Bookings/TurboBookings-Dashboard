import "server-only";
import { and, eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/client";
import { getDb, bookings } from "@/lib/db";
import { ensurePlatformCustomer } from "@/lib/billing/retainer";
import { recordAudit } from "@/lib/audit";
import type { Location } from "@/lib/db/schema";

/**
 * Bill an uncollected platform fee back to the OPERATOR.
 *
 * Why this exists rather than a retry: when our 6% rises after checkout and the card top-up fails,
 * the shortfall stays inside `balance_due`, which the customer settles at the venue. So once the tour
 * has run, the operator has physically collected our money in cash. Retrying the card at that point
 * charges the customer a second time for the same thing.
 *
 * The alternative was asking the operator to send money back, off-system, per booking, forever. That
 * does not survive contact with 3–5 more operator clients — per-operator friction is the thing that
 * scales badly here, not per-booking work.
 *
 * So it becomes a Stripe **invoice item** on the operator's PLATFORM customer — the same customer
 * their monthly retainer bills. A pending invoice item automatically attaches to the next invoice
 * Stripe creates for that customer, so it rides along on the retainer with no separate collection
 * step, no reconciliation, and a paper trail on both sides.
 *
 * ⚠️ Everything here runs on OUR platform account — `getStripe()` with no `{ stripeAccount }`. The 6%
 * lives on the connected account; this does not. Passing the connected account would bill the
 * operator's own customer list.
 */
export async function billFeeToOperator(
  location: Location,
  bookingId: string,
  note: string,
): Promise<{ ok: boolean; error?: string; invoiceItemId?: string }> {
  const db = getDb();
  const b = (
    await db
      .select({
        displayNumber: bookings.displayNumber,
        amount: bookings.platformFeeUncollectedCents,
        writtenOffAt: bookings.platformFeeWrittenOffAt,
        billedAt: bookings.platformFeeBilledToOperatorAt,
      })
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.locationId, location.id)))
      .limit(1)
  )[0];

  if (!b) return { ok: false, error: "Booking not found" };
  if (b.amount <= 0) return { ok: false, error: "Nothing outstanding on this booking." };
  // Guard the double-bill directly, rather than trusting the list the button was rendered from — a
  // stale page is exactly how the same fee gets billed twice.
  if (b.billedAt) return { ok: false, error: "Already billed to the operator." };
  if (b.writtenOffAt) return { ok: false, error: "Already written off." };

  let invoiceItemId: string;
  try {
    const customerId = await ensurePlatformCustomer(location);
    const item = await getStripe().invoiceItems.create({
      customer: customerId,
      amount: b.amount,
      currency: "usd",
      description: `Booking #${b.displayNumber} — booking fee collected at the venue (${note})`,
      metadata: {
        locationId: location.id,
        slug: location.slug,
        bookingId,
        kind: "platform_fee_recovery",
      },
    });
    invoiceItemId = item.id;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not add the charge in Stripe.",
    };
  }

  await db
    .update(bookings)
    .set({
      platformFeeBilledToOperatorAt: new Date(),
      platformFeeOperatorInvoiceItemId: invoiceItemId,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId));

  await recordAudit({
    slug: location.slug,
    action: "catalog.booking.platform_fee_billed_to_operator",
    summary: `#${b.displayNumber} — $${(b.amount / 100).toFixed(2)} billed to the operator's next invoice`,
    payload: { bookingId, amountCents: b.amount, invoiceItemId, note },
  });

  return { ok: true, invoiceItemId };
}

/**
 * Whether the operator has a live retainer to carry these charges.
 *
 * A pending invoice item is only collected when Stripe next creates an invoice for that customer. No
 * subscription means no invoice, which means the charge sits indefinitely — true, recorded, and
 * uncollected. That is worth saying out loud on the report rather than letting someone believe the
 * money is on its way.
 */
export function retainerWillCollect(location: Location): boolean {
  return !!location.stripeSubscriptionId && location.retainerStatus === "active";
}
