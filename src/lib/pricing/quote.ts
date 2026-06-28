// Pricing math — identical to the booking app's quote (kept in sync; separate
// repos). Used by operator manual-booking (charge path) to compute amounts.
export type ChargeMode = "passed_to_customer" | "absorbed_by_client";
export type DepositMode = "full" | "flat" | "per_person" | "per_unit" | "percent";

export type QuoteLine = {
  quantity: number;
  unitPriceCents: number;
  taxRateBpsOverride?: number | null;
};

export type QuoteInput = {
  lines: QuoteLine[];
  depositMode: DepositMode;
  depositAmountCents: number | null;
  depositPercentBps: number | null;
  platformFeeBps: number;
  platformFeeMode: ChargeMode;
  taxRateBps: number;
  taxMode: ChargeMode;
};

export type Quote = {
  subtotalCents: number;
  taxCents: number;
  feeCents: number;
  depositCents: number;
  totalDueOnlineCents: number;
  balanceDueAtVenueCents: number;
  applicationFeeCents: number;
};

export function quote(input: QuoteInput): Quote {
  const subtotal = input.lines.reduce(
    (s, l) => s + l.quantity * l.unitPriceCents,
    0,
  );
  const totalQty = input.lines.reduce((s, l) => s + l.quantity, 0);
  const taxFull = input.lines.reduce((s, l) => {
    const bps = l.taxRateBpsOverride ?? input.taxRateBps;
    return s + Math.round(l.quantity * l.unitPriceCents * (bps / 10000));
  }, 0);
  const feeFull = Math.round(subtotal * (input.platformFeeBps / 10000));
  const taxCents = input.taxMode === "passed_to_customer" ? taxFull : 0;
  const feeCents = input.platformFeeMode === "passed_to_customer" ? feeFull : 0;

  let depositCents: number;
  switch (input.depositMode) {
    case "full":
      depositCents = subtotal;
      break;
    case "flat":
      depositCents = input.depositAmountCents ?? 0;
      break;
    case "per_person":
    case "per_unit":
      depositCents = (input.depositAmountCents ?? 0) * totalQty;
      break;
    case "percent":
      depositCents = Math.round(subtotal * ((input.depositPercentBps ?? 0) / 10000));
      break;
    default:
      depositCents = subtotal;
  }
  depositCents = Math.max(0, Math.min(depositCents, subtotal));

  return {
    subtotalCents: subtotal,
    taxCents,
    feeCents,
    depositCents,
    totalDueOnlineCents: depositCents + taxCents + feeCents,
    balanceDueAtVenueCents: subtotal - depositCents,
    applicationFeeCents: feeFull,
  };
}
