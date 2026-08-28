// Day-of-week × daypart bucketing for the inventory feed.
//
// ## Why day-of-week and not "weekend vs midweek"
//
// The whole point of the feed is to say WHICH periods can absorb more demand, and "weekend" is too
// coarse to act on: Dallas Friday runs at 25% while Dallas Saturday runs at 72%. Collapsing them
// hides the only distinction that matters.
//
// ## ⚠️ This is the TOUR day, never the booking day
//
// Two different days get called "day of week" in this system and conflating them is expensive:
//
//   * **Tour day** — when the ride actually happens. That is what capacity is about, and it is what
//     everything in this module measures.
//   * **Booking day** — when the customer bought. That is what Google's `set_ad_schedule` bids on.
//
// They are not interchangeable. Measured over 84 days, Dallas books 24% of everything on Thursday and
// two thirds of that lands on Saturday tours. So "Saturday tours are full" does NOT imply "bid down
// Saturday" — and it certainly does not imply "bid down Thursday", which would cut the best-converting
// day and send those riders to a competitor rather than to a Monday slot.
//
// `bookingDayMatrix` in `./leadTime.ts` measures the relationship instead of assuming it.

export const DAYPARTS = ["morning", "afternoon", "evening"] as const;
export type Daypart = (typeof DAYPARTS)[number];

/**
 * Local-hour boundaries, half-open `[from, to)`.
 *
 * Chosen against how the tours actually run rather than clock aesthetics: the glow/night tours that
 * dominate late demand all start at 17:00 or later, so a 17:00 boundary keeps them in one bucket
 * instead of splitting a single product across two.
 */
export const DAYPART_HOURS: Record<Daypart, { from: number; to: number }> = {
  morning: { from: 0, to: 12 },
  afternoon: { from: 12, to: 17 },
  evening: { from: 17, to: 24 },
};

export const DOW_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/** `0` = Sunday … `6` = Saturday, matching JS `getDay()` and `discount_codes.valid_days_of_week`. */
export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function daypartForHour(hour: number): Daypart {
  for (const name of DAYPARTS) {
    const { from, to } = DAYPART_HOURS[name];
    if (hour >= from && hour < to) return name;
  }
  // Unreachable while the table covers 0–23, but a silent wrong bucket would be worse than a throw.
  throw new Error(`hour ${hour} falls outside every daypart`);
}

export type CellKey = `${Dow}:${Daypart}`;

export function cellKey(dow: Dow, daypart: Daypart): CellKey {
  return `${dow}:${daypart}`;
}

/**
 * Wall-clock length of a daypart in hours. NOT a capacity denominator.
 *
 * Dividing sold machine-hours by this would report a market as idle simply because it is closed:
 * Dallas runs no midweek mornings, so its "fill" would read ~0% for a period it never offered. The
 * denominator has to be the union of slot intervals actually opened — see `structural.ts`.
 */
export function daypartLengthHours(daypart: Daypart): number {
  const { from, to } = DAYPART_HOURS[daypart];
  return to - from;
}
