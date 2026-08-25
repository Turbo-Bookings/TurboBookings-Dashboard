/**
 * Numeric check on `quoteBalanceCharge` — the arithmetic that decides what a customer is charged at
 * the desk and how much of it is ours.
 *
 *   npx tsx scripts/check-balance-charge.ts
 *
 * No database, no Stripe. Every case below is a real shape from production.
 */
import { quoteBalanceCharge, type BalanceQuoteInput } from "../src/lib/booking/balanceCharge";

const base: BalanceQuoteInput = {
  subtotalCents: 0,
  discountCents: 0,
  taxCents: 0,
  totalCents: 0,
  balanceDueCents: 0,
  platformFeeCents: 0,
  platformFeeUncollectedCents: 0,
  feeAlreadyResolved: false,
  platformFeeBps: 600,
  passedToCustomer: true,
  grouponOta: false,
  importedBooking: false,
};

let failures = 0;
function check(name: string, got: number, want: number) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(
    `    ${ok ? "ok  " : "FAIL"} ${name.padEnd(26)} got ${(got / 100).toFixed(2).padStart(9)}  want ${(want / 100).toFixed(2)}`,
  );
}

console.log("\nA. Walk-in booked as pay-at-venue, $400, now paying by card at the desk");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 40000,
    totalCents: 40000,
    balanceDueCents: 40000,
  });
  check("charged now", q.chargeCents, 42400); // 400 + 6%
  check("our cut", q.applicationFeeCents, 2400);
  check("fee added to total", q.feeAddedCents, 2400);
  check("new total", q.newTotalCents, 42400);
}

console.log("\nB. Dallas #0395 — grew from 2 to 6 ATVs, four top-ups failed");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 72000,
    taxCents: 280,
    totalCents: 76600,
    balanceDueCents: 70880,
    platformFeeCents: 1440,
    platformFeeUncollectedCents: 2880,
  });
  // The full 6% is ALREADY inside the total. Adding it again would bill the customer twice.
  check("charged now", q.chargeCents, 70880);
  check("fee added to total", q.feeAddedCents, 0);
  check("our cut", q.applicationFeeCents, 2880); // exactly the shortfall
  check("new total", q.newTotalCents, 76600);
}

console.log("\nC. Ordinary online booking, deposit paid, fee fully collected up front");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 30000,
    taxCents: 0,
    totalCents: 31800, // 300 + 6%
    balanceDueCents: 25000,
    platformFeeCents: 1800,
  });
  check("charged now", q.chargeCents, 25000);
  check("our cut", q.applicationFeeCents, 0); // nothing outstanding — all of it is the operator's
  check("fee added to total", q.feeAddedCents, 0);
}

console.log("\nD. Shortfall already billed to the operator — must not also come from the customer");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 72000,
    taxCents: 280,
    totalCents: 76600,
    balanceDueCents: 70880,
    platformFeeCents: 1440,
    platformFeeUncollectedCents: 2880,
    feeAlreadyResolved: true,
  });
  check("charged now", q.chargeCents, 70880); // customer still owes the balance
  check("our cut", q.applicationFeeCents, 0); // but we take none of it — it is on their invoice
}

console.log("\nE. Operator absorbs the fee — customer's total must not move");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 40000,
    totalCents: 40000,
    balanceDueCents: 40000,
    passedToCustomer: false,
  });
  check("charged now", q.chargeCents, 40000);
  check("fee added to total", q.feeAddedCents, 0);
  check("our cut", q.applicationFeeCents, 2400); // out of the operator's share
}

console.log("\nF. Discounted walk-in — the 6% follows the discounted price, not the list price");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 40000,
    discountCents: 10000,
    totalCents: 30000,
    balanceDueCents: 30000,
  });
  check("charged now", q.chargeCents, 31800); // 6% of $300, not of $400
  check("our cut", q.applicationFeeCents, 1800);
}

console.log("\nH. Groupon/OTA — prepaid $50, $150 due, pays the rest by card. We earn nothing.");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 20000,
    totalCents: 20000,
    balanceDueCents: 15000,
    grouponOta: true,
  });
  check("charged now", q.chargeCents, 15000); // NOT 159.00 — no 6% appears at the desk
  check("fee added to total", q.feeAddedCents, 0);
  check("our cut", q.applicationFeeCents, 0);
}

console.log("\nI. Booking grew then shrank — the ratchet holds, we do not hand the fee back");
{
  // htown #0323 exactly. The fee ratcheted to $10.20, then a rider was removed, so 6% of the CURRENT
  // subtotal is only $9.00. We are still owed the $1.20 that was never collected. The total also
  // carries a per-person venue fee, which is the operator's and must not be read as ours.
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 15000,
    taxCents: 140,
    totalCents: 18160,
    balanceDueCents: 15120,
    platformFeeCents: 900,
    platformFeeUncollectedCents: 120,
  });
  check("charged now", q.chargeCents, 15120);
  check("fee added to total", q.feeAddedCents, 0);
  check("our cut", q.applicationFeeCents, 120);
}

console.log("\nJ. Total below its own subtotal (subtotal_cents_override) — miami #0143");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 36000,
    totalCents: 34160,
    balanceDueCents: 18860,
    platformFeeCents: 0,
    platformFeeUncollectedCents: 2160,
  });
  check("charged now", q.chargeCents, 18860);
  // Already priced in, despite the residue coming out negative.
  check("fee added to total", q.feeAddedCents, 0);
  check("our cut", q.applicationFeeCents, 2160);
}

console.log("\nK. FareHarbor import settling up — we must not re-price someone else's booking");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 30000,
    totalCents: 30000,
    balanceDueCents: 24000,
    importedBooking: true,
  });
  check("charged now", q.chargeCents, 24000); // NOT 254.00
  check("fee added to total", q.feeAddedCents, 0);
  check("our cut", q.applicationFeeCents, 0);
}

console.log("\nG. Nothing left to collect");
{
  const q = quoteBalanceCharge({
    ...base,
    subtotalCents: 30000,
    totalCents: 31800,
    balanceDueCents: 0,
    platformFeeCents: 1800,
  });
  check("charged now", q.chargeCents, 0);
  check("our cut", q.applicationFeeCents, 0);
}

console.log(failures === 0 ? "\nall cases pass\n" : `\n${failures} FAILING\n`);
process.exit(failures === 0 ? 0 : 1);
