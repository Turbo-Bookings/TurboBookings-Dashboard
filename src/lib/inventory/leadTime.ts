import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { DOW_NAMES, type Dow } from "./dayparts";

// How far ahead people book, and which booking days feed which tour days.
//
// ## Why this ships with the capacity feed rather than being assumed
//
// The near-term half is worthless without it. With a median lead time under a day, a slot three days
// out is empty because nobody has booked it YET — read as demand, that is a signal to scale into
// nothing. The horizon has to be sized from measured behaviour, and the "empty is normal" rule has to
// be justified by a number rather than asserted.
//
// ## The matrix, and the mistake it prevents
//
// Google's `set_ad_schedule` bids on the day an ad is SERVED. Capacity is about the day a tour RUNS.
// An earlier draft of this feed treated those as the same dimension, which would have been expensive:
// measured over 84 days, Dallas books 24% of everything on a Thursday and two thirds of that lands on
// Saturday tours. "Saturday is full" therefore does NOT imply "bid down Saturday", and it certainly
// does not imply "bid down Thursday" — that cuts the best-converting day, and those riders do not
// then book a Monday, they book a competitor.
//
// Shipping the matrix means any future serving-day inference is grounded in what actually happens
// rather than in an assumption that sounds reasonable.

export type LeadTime = {
  bookings: number;
  medianDays: number | null;
  p95Days: number | null;
  /** Share booked within one day / three days / seven days of the tour. */
  within1dPct: number | null;
  within3dPct: number | null;
  within7dPct: number | null;
};

export type BookingDayCell = {
  bookedDow: Dow;
  bookedDowName: string;
  tourDow: Dow;
  tourDowName: string;
  bookings: number;
  shareOfAllPct: number;
};

export type LeadTimeResult = {
  lookbackDays: number;
  leadTime: LeadTime;
  /**
   * Rows = day the booking was MADE, columns = day the tour RUNS.
   *
   * ⚠️ Never collapse this into "day of week". The two dimensions are different and conflating them
   * is the single most expensive mistake available here.
   */
  bookingDayMatrix: BookingDayCell[];
};

type LeadRow = { days: number | string };
type MatrixRow = { booked_dow: number | string; tour_dow: number | string; n: number | string };

/**
 * Recommended near-term horizon: enough days to cover ~95% of this market's booking window.
 *
 * Derived rather than hardcoded because the three markets differ by an order of magnitude — Houston's
 * median is ~0.2 days against Dallas's ~1.7 — and because a lengthening lead time is itself a
 * scarcity signal worth catching later. Clamped so a quiet week cannot collapse the horizon to
 * nothing or blow it out to a month.
 */
export function horizonDaysFor(lead: LeadTime): number {
  const p95 = lead.p95Days;
  if (p95 == null || !Number.isFinite(p95)) return 7;
  return Math.min(14, Math.max(3, Math.ceil(p95) + 1));
}

export async function leadTimeAndMatrix(
  locationId: string,
  tz: string,
  opts: { lookbackDays?: number } = {},
): Promise<LeadTimeResult> {
  const lookbackDays = opts.lookbackDays ?? 84;
  const db = getDb();

  // Only tours that have already RUN: a future tour's bookings are still arriving, so including them
  // would bias every lead time downward as the tour approaches.
  //
  // `bookings.created_at` is a NAIVE timestamp holding UTC — the repo-wide convention is to compare it
  // via `at time zone 'utc'` rather than trusting the session zone.
  const leadRows = (await db.execute(sql`
    SELECT GREATEST(0, EXTRACT(epoch FROM (a.starts_at - (b.created_at AT TIME ZONE 'utc'))) / 86400.0) AS days
      FROM bookings b
      JOIN availabilities a ON a.id = b.availability_id
     WHERE b.location_id = ${locationId}::uuid
       AND b.status = 'active'
       AND b.external_ref IS NULL
       AND a.starts_at < now()
       AND a.starts_at >= now() - (${lookbackDays} || ' days')::interval
  `)) as unknown as { rows?: LeadRow[] } | LeadRow[];
  const lead = (Array.isArray(leadRows) ? leadRows : (leadRows.rows ?? []))
    .map((r) => Number(r.days))
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);

  const pct = (within: number) =>
    lead.length ? Math.round((100 * lead.filter((d) => d <= within).length) / lead.length) : null;
  const quantile = (q: number) =>
    lead.length ? Math.round(lead[Math.min(lead.length - 1, Math.floor(q * lead.length))]! * 10) / 10 : null;

  const matrixRows = (await db.execute(sql`
    SELECT EXTRACT(dow FROM ((b.created_at AT TIME ZONE 'utc') AT TIME ZONE ${tz}))::int AS booked_dow,
           EXTRACT(dow FROM (a.starts_at AT TIME ZONE ${tz}))::int AS tour_dow,
           COUNT(*)::int AS n
      FROM bookings b
      JOIN availabilities a ON a.id = b.availability_id
     WHERE b.location_id = ${locationId}::uuid
       AND b.status = 'active'
       AND b.external_ref IS NULL
       AND a.starts_at >= now() - (${lookbackDays} || ' days')::interval
     GROUP BY 1, 2
  `)) as unknown as { rows?: MatrixRow[] } | MatrixRow[];
  const rows = Array.isArray(matrixRows) ? matrixRows : (matrixRows.rows ?? []);
  const total = rows.reduce((s, r) => s + Number(r.n), 0);

  return {
    lookbackDays,
    leadTime: {
      bookings: lead.length,
      medianDays: quantile(0.5),
      p95Days: quantile(0.95),
      within1dPct: pct(1),
      within3dPct: pct(3),
      within7dPct: pct(7),
    },
    bookingDayMatrix: rows
      .map((r) => {
        const bookedDow = Number(r.booked_dow) as Dow;
        const tourDow = Number(r.tour_dow) as Dow;
        return {
          bookedDow,
          bookedDowName: DOW_NAMES[bookedDow],
          tourDow,
          tourDowName: DOW_NAMES[tourDow],
          bookings: Number(r.n),
          shareOfAllPct: total ? Math.round((1000 * Number(r.n)) / total) / 10 : 0,
        };
      })
      .sort((a, b) => b.bookings - a.bookings),
  };
}
