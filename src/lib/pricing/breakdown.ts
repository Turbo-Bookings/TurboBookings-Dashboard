import type { ChargeMode, DepositMode } from "@/lib/pricing/quote";

// Operator-booking pricing. Key rules (operator-confirmed):
//  - The processing (platform) fee is computed on the FULL subtotal and is
//    ALWAYS collected up-front — but only when a card is charged through us
//    (walk-in / Groupon carry no platform fee).
//  - Tax is charged only on the amount actually paid ONLINE (deposit / partial /
//    full). The remaining tour cost + its tax is collected at the venue POS.
//  - Due now = online amount + tax-on-that-amount + full fee.

export type PaymentMethod = "card" | "groupon_ota" | "walk_in";
export type AmountMode = "full" | "deposit" | "partial";

export type ComputeInput = {
  baseSubtotalCents: number; // override ?? sum(line qty × price)
  discountCents: number;
  taxRateBps: number;
  taxMode: ChargeMode;
  platformFeeBps: number;
  platformFeeMode: ChargeMode;
  depositMode: DepositMode;
  depositAmountCents: number | null;
  depositPercentBps: number | null;
  totalQty: number;
  paymentMethod: PaymentMethod;
  amountMode: AmountMode; // card only
  amountCents?: number; // partial charge (card) or Groupon prepaid
};

export type Computed = {
  subtotalCents: number;
  discountCents: number;
  adjustedSubtotalCents: number;
  depositCents: number; // configured deposit on the adjusted subtotal
  feeCents: number; // full fee (card only, passed mode)
  applicationFeeCents: number; // full fee regardless of mode (for Stripe app_fee)
  onlineBaseCents: number; // amount toward the tour paid online
  onlineTaxCents: number; // tax on onlineBase (card only, passed mode)
  dueNowCents: number; // onlineBase + onlineTax + fee
  totalCents: number; // adjustedSubtotal + fee + onlineTax (what we track/charge)
  balanceDueCents: number; // total − dueNow (remaining tour cost; venue tax extra)
};

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

export function computeBooking(i: ComputeInput): Computed {
  const subtotal = Math.max(0, Math.round(i.baseSubtotalCents));
  const discount = Math.max(0, Math.min(Math.round(i.discountCents), subtotal));
  const adjusted = subtotal - discount;

  const card = i.paymentMethod === "card";
  const feeFull = card ? Math.round(adjusted * (i.platformFeeBps / 10000)) : 0;
  const feeCents = card && i.platformFeeMode === "passed_to_customer" ? feeFull : 0;

  const deposit = depositForMode({
    adjustedSubtotalCents: adjusted,
    depositMode: i.depositMode,
    depositAmountCents: i.depositAmountCents,
    depositPercentBps: i.depositPercentBps,
    totalQty: i.totalQty,
  });

  let onlineBase: number;
  if (i.paymentMethod === "walk_in") onlineBase = 0;
  else if (i.paymentMethod === "groupon_ota")
    onlineBase = Math.max(0, Math.min(Math.round(i.amountCents ?? 0), adjusted));
  else if (i.amountMode === "full") onlineBase = adjusted;
  else if (i.amountMode === "deposit") onlineBase = Math.min(deposit, adjusted);
  else onlineBase = Math.max(0, Math.min(Math.round(i.amountCents ?? 0), adjusted)); // partial

  const onlineTaxCents =
    card && i.taxMode === "passed_to_customer"
      ? Math.round(onlineBase * (i.taxRateBps / 10000))
      : 0;

  const dueNowCents = onlineBase + onlineTaxCents + feeCents;
  const totalCents = adjusted + feeCents + onlineTaxCents;

  return {
    subtotalCents: subtotal,
    discountCents: discount,
    adjustedSubtotalCents: adjusted,
    depositCents: deposit,
    feeCents,
    applicationFeeCents: feeFull,
    onlineBaseCents: onlineBase,
    onlineTaxCents,
    dueNowCents,
    totalCents,
    balanceDueCents: totalCents - dueNowCents,
  };
}
