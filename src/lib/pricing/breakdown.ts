import type { ChargeMode, DepositMode } from "@/lib/pricing/quote";

// Operator-booking pricing: a base subtotal (line total or manual override),
// minus a discount, with taxes + processing fee recomputed off the adjusted
// subtotal. Kept separate from the customer-flow quote() (which has no override
// / discount) so each stays simple.

export type BreakdownInput = {
  baseSubtotalCents: number; // override ?? sum(line qty × price)
  discountCents: number;
  taxRateBps: number;
  taxMode: ChargeMode;
  platformFeeBps: number;
  platformFeeMode: ChargeMode;
  // The platform processing fee is only collected when a card is charged
  // through us. Walk-in / Groupon bookings carry no platform fee.
  collectFee?: boolean;
};

export type Breakdown = {
  subtotalCents: number;
  discountCents: number;
  adjustedSubtotalCents: number; // subtotal − discount (≥ 0)
  taxCents: number;
  feeCents: number;
  applicationFeeCents: number; // full fee (passed to Stripe as application_fee)
  totalCents: number;
};

export function priceBreakdown(i: BreakdownInput): Breakdown {
  const subtotal = Math.max(0, Math.round(i.baseSubtotalCents));
  const discount = Math.max(0, Math.min(Math.round(i.discountCents), subtotal));
  const adjusted = subtotal - discount;
  const collectFee = i.collectFee !== false;
  const taxFull = Math.round(adjusted * (i.taxRateBps / 10000));
  const feeFull = collectFee ? Math.round(adjusted * (i.platformFeeBps / 10000)) : 0;
  const taxCents = i.taxMode === "passed_to_customer" ? taxFull : 0;
  const feeCents = collectFee && i.platformFeeMode === "passed_to_customer" ? feeFull : 0;
  return {
    subtotalCents: subtotal,
    discountCents: discount,
    adjustedSubtotalCents: adjusted,
    taxCents,
    feeCents,
    applicationFeeCents: feeFull,
    totalCents: adjusted + taxCents + feeCents,
  };
}

// Deposit amount per the location's deposit settings, computed on the adjusted
// subtotal. Mirrors quote()'s deposit logic.
export function depositForMode(input: {
  adjustedSubtotalCents: number;
  depositMode: DepositMode;
  depositAmountCents: number | null;
  depositPercentBps: number | null;
  totalQty: number;
}): number {
  const s = input.adjustedSubtotalCents;
  let d: number;
  switch (input.depositMode) {
    case "full":
      d = s;
      break;
    case "flat":
      d = input.depositAmountCents ?? 0;
      break;
    case "per_person":
    case "per_unit":
      d = (input.depositAmountCents ?? 0) * input.totalQty;
      break;
    case "percent":
      d = Math.round(s * ((input.depositPercentBps ?? 0) / 10000));
      break;
    default:
      d = s;
  }
  return Math.max(0, Math.min(d, s));
}
