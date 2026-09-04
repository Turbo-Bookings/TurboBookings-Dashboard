import { DateTime } from "luxon";

/**
 * When the first retainer charge lands, and whether that is "now".
 *
 * Pure date arithmetic, deliberately in its own module with no `server-only`: the settings screen
 * shows this date to the operator as they type the billing day, so the client needs the same
 * function the subscription is actually created with. Two implementations of "when does this first
 * charge" would be two chances to disagree, and the operator would trust the one on screen.
 */

/** Stripe billing days are clamped to 1–28 so every month has one. */
export const MAX_BILLING_DAY = 28;

function clampDay(day: number): number {
  return Math.min(Math.max(1, Math.floor(day)), MAX_BILLING_DAY);
}

/**
 * The billing day at 09:00 local, rolled forward if it has passed — EXCEPT when the billing day is
 * today, in which case the charge is now.
 *
 * That exception exists because of Dallas on 2026-09-04: the retainer was set up at 11:37 CT for
 * billing day 4, missed the 09:00 anchor by 2h37m, and silently deferred to 4 October. Nothing on
 * screen said so, and the operator expected a charge that day. Choosing today means today.
 *
 * Any OTHER past day still rolls to next month, which is right — picking the 4th on the 20th means
 * next month's 4th.
 */
export function firstChargeAt(
  day: number,
  timezone: string,
  now = DateTime.now(),
): DateTime {
  const d = clampDay(day);
  const local = now.setZone(timezone);
  const anchor = local.set({ day: d, hour: 9, minute: 0, second: 0, millisecond: 0 });
  if (anchor > local) return anchor;
  if (local.day === d) return local;
  return anchor.plus({ months: 1 }).set({ day: d });
}

/**
 * Whether the first charge is "now" rather than a date to trial towards.
 *
 * The two cases are DIFFERENT Stripe calls, not different numbers: a subscription created with no
 * `trial_end` bills immediately and anchors its cycle to that moment, whereas a `trial_end` of
 * roughly-now is not equivalent and Stripe will not reliably accept it — the timestamp has to be
 * meaningfully in the future.
 */
export function billsImmediately(
  day: number,
  timezone: string,
  now = DateTime.now(),
): boolean {
  const d = clampDay(day);
  const local = now.setZone(timezone);
  const anchor = local.set({ day: d, hour: 9, minute: 0, second: 0, millisecond: 0 });
  return anchor <= local && local.day === d;
}

/** "today" / "4 October 2026" — what the settings screen prints next to the Start button. */
export function firstChargeLabel(
  day: number,
  timezone: string,
  now = DateTime.now(),
): string {
  if (billsImmediately(day, timezone, now)) return "today";
  return firstChargeAt(day, timezone, now).toFormat("d LLLL yyyy");
}
