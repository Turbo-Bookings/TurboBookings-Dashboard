/**
 * Money formatting, in one place.
 *
 * Deliberately not `server-only` — half the callers are client components.
 *
 * This existed as eleven identical copies of the same three lines, one per file that needed it. They
 * had not drifted, but nothing stopped them: a currency or a locale changed in ten places and missed
 * in the eleventh reads as a rendering glitch rather than a bug, and the eleventh is always the one
 * nobody opens.
 */

/** Cents → `$1,234.56`. */
export function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Cents → `$1,235` — no cents shown.
 *
 * For summary tiles where the pennies are noise and the column alignment matters more. Never use it
 * on a figure someone has to reconcile against a bank statement or hand to a customer.
 */
export function usdRound(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
