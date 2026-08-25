/**
 * The price breakdown a customer sees, as rows — shared so the modal and the booking page cannot
 * disagree about the same booking.
 *
 * ## Why this is derived rather than listed
 *
 * The obvious version prints the columns: subtotal, discount, tax, fee, total. It was wrong on **465
 * of 1,195 live bookings** — 39% — because it silently assumed those columns account for the total.
 *
 * They do not. Every FareHarbor booking imported at cutover carries its gross total in `total_cents`
 * with `tax_cents` and `platform_fee_cents` at zero, because the CSV never broke them out. So a
 * $200 booking rendered as "Subtotal $200.00 · Total $216.50" with $16.50 unexplained, and nothing on
 * screen admitted a line was missing. Staff read that to customers.
 *
 * So the "taxes & fees" row is computed as *whatever is on top of the tour price* rather than as the
 * sum of two columns that may not be populated. It reconciles by construction: the rows always add
 * up to the total, whatever produced the total.
 *
 * `subtotal_cents_override` lets a total fall BELOW its own subtotal, so the remainder can be
 * negative. That is a discount applied after the fact, and it is labelled as one rather than shown as
 * a negative fee.
 *
 * The platform fee is never itemized for anyone — see the note in `BookingModal.tsx`.
 */

export type BreakdownRow = {
  label: string;
  cents: number;
  /** Render bold — the total. */
  strong?: boolean;
  /** Render de-emphasised — money already handled, or owed later. */
  muted?: boolean;
  /** Show with a leading minus. */
  negative?: boolean;
};

export type BreakdownInput = {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  depositPaidCents: number;
  balanceDueCents: number;
  refundedCents: number;
};

export function customerBreakdown(b: BreakdownInput): BreakdownRow[] {
  const rows: BreakdownRow[] = [{ label: "Subtotal", cents: b.subtotalCents }];

  if (b.discountCents > 0) {
    rows.push({ label: "Discount", cents: b.discountCents, negative: true });
  }

  // Everything charged on top of the tour price: tax, our fee, and any venue/park admission — the
  // same single line the customer saw at checkout, and the reason the rows always reconcile.
  const adjusted = b.subtotalCents - b.discountCents;
  const onTop = b.totalCents - adjusted;
  if (onTop > 0) {
    rows.push({ label: "Taxes & fees", cents: onTop });
  } else if (onTop < 0) {
    rows.push({ label: "Adjustment", cents: -onTop, negative: true });
  }

  rows.push({ label: "Total", cents: b.totalCents, strong: true });
  rows.push({ label: "Paid", cents: b.depositPaidCents });
  if (b.balanceDueCents > 0) {
    rows.push({ label: "Balance at venue", cents: b.balanceDueCents, muted: true });
  }
  if (b.refundedCents > 0) {
    rows.push({ label: "Refunded", cents: b.refundedCents, muted: true });
  }
  return rows;
}
