import "server-only";
import { and, desc, eq, gt, gte, inArray, lt, ne, sql } from "drizzle-orm";
import {
  auditLog,
  availabilities,
  bookingFollowups,
  bookingLines,
  bookingReschedules,
  bookings,
  customers,
  getDb,
  items,
  noShowCases,
  payments,
} from "@/lib/db";
import type { FollowupStatus } from "@/lib/booking/followupStatus";
import { bookingRollup, type CheckInRollup } from "@/lib/data/bookings";
import {
  BUCKET_ORDER,
  resolveCase,
  type CaseState,
} from "@/lib/booking/noShowCase";

/**
 * Queries behind the reports.
 *
 * Kept out of `data/bookings.ts`, which is already 1000+ lines and serves the manifest and the grid —
 * the screens the venue refreshes all day. A report query has no business sharing a file with those.
 */

type LineRow = {
  bookingId: string;
  displayNumber: string;
  itemName: string;
  startsAt: Date;
  balanceDueCents: number;
  quantity: number | null;
  checkedInUnits: number | null;
  noShowUnits: number | null;
};

type Units = { quantity: number; checkedInUnits: number; noShowUnits: number };

/** One row per booking-line, joined to its tour and slot, for tours running in the range. */
async function linesInRange(locationId: string, from: Date, to: Date): Promise<LineRow[]> {
  return getDb()
    .select({
      bookingId: bookings.id,
      displayNumber: bookings.displayNumber,
      itemName: items.name,
      startsAt: availabilities.startsAt,
      balanceDueCents: bookings.balanceDueCents,
      quantity: bookingLines.quantity,
      checkedInUnits: bookingLines.checkedInUnits,
      noShowUnits: bookingLines.noShowUnits,
    })
    .from(bookings)
    .innerJoin(availabilities, eq(availabilities.id, bookings.availabilityId))
    .innerJoin(items, eq(items.id, bookings.itemId))
    .leftJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.locationId, locationId),
        eq(bookings.status, "active"),
        gte(availabilities.startsAt, from),
        lt(availabilities.startsAt, to),
      ),
    );
}

/** Fold the line rows back up into one entry per booking. */
function foldByBooking(rows: LineRow[]): Map<string, { row: LineRow; lines: Units[] }> {
  const out = new Map<string, { row: LineRow; lines: Units[] }>();
  for (const r of rows) {
    // A booking with no lines still joins once, with nulls. Keep it as a booking with zero units
    // rather than dropping it, or the booking counts silently disagree with every other screen.
    const line: Units | null =
      r.quantity == null
        ? null
        : {
            quantity: r.quantity,
            checkedInUnits: r.checkedInUnits ?? 0,
            noShowUnits: r.noShowUnits ?? 0,
          };
    const hit = out.get(r.bookingId);
    if (hit) {
      if (line) hit.lines.push(line);
    } else {
      out.set(r.bookingId, { row: r, lines: line ? [line] : [] });
    }
  }
  return out;
}

const sumUnits = (lines: Units[]) => ({
  qty: lines.reduce((s, l) => s + l.quantity, 0),
  ci: lines.reduce((s, l) => s + l.checkedInUnits, 0),
  ns: lines.reduce((s, l) => s + l.noShowUnits, 0),
});

// ---------------------------------------------------------------- check-in

export type CheckInTourRow = {
  itemName: string;
  bookings: number;
  vehicles: number;
  checkedIn: number;
  noShow: number;
  /** Units on a tour that has ALREADY RUN and was never marked either way — a desk miss. */
  notMarked: number;
  /** Units on a tour that has not run yet. Not a miss; nothing has happened to them. */
  upcoming: number;
};

export type CheckInReport = {
  byTour: CheckInTourRow[];
  totals: Omit<CheckInTourRow, "itemName">;
  /** Bookings where some units checked in AND some were marked no-show — worth a look. */
  partialBookings: number;
  /** True when the range reaches into tours that have not happened yet. */
  hasUpcoming: boolean;
};

/**
 * Who rode, who did not, and who was never marked either way.
 *
 * The third number is the point of the report. A no-show rate computed only over bookings somebody
 * remembered to touch is a rate over an unknown denominator: if half the day was never marked, the
 * figure is meaningless and looks entirely reasonable. So "not marked" is reported beside the other
 * two rather than folded into either.
 */
export async function checkInReport(
  locationId: string,
  from: Date,
  to: Date,
): Promise<CheckInReport> {
  const byBooking = foldByBooking(await linesInRange(locationId, from, to));
  const tours = new Map<string, CheckInTourRow>();
  let partialBookings = 0;
  const now = Date.now();

  for (const { row, lines } of byBooking.values()) {
    const t = tours.get(row.itemName) ?? {
      itemName: row.itemName,
      bookings: 0,
      vehicles: 0,
      checkedIn: 0,
      noShow: 0,
      notMarked: 0,
      upcoming: 0,
    };
    const { qty, ci, ns } = sumUnits(lines);
    const unmarked = Math.max(0, qty - ci - ns);
    t.bookings += 1;
    t.vehicles += qty;
    t.checkedIn += ci;
    t.noShow += ns;
    // A tour that has not run yet cannot have been "missed" by the desk — nothing has happened to
    // it. Counting those as never-marked made the report unreadable for any range containing today:
    // it opened on a Tuesday morning showing 0 checked in and every booked vehicle as unmarked,
    // which reads as "nobody was checked in" rather than "today has not happened".
    if (row.startsAt.getTime() > now) t.upcoming += unmarked;
    else t.notMarked += unmarked;
    tours.set(row.itemName, t);
    if (ci > 0 && ns > 0) partialBookings++;
  }

  const byTour = [...tours.values()].sort((a, b) => b.vehicles - a.vehicles);
  const totals = byTour.reduce(
    (a, t) => ({
      bookings: a.bookings + t.bookings,
      vehicles: a.vehicles + t.vehicles,
      checkedIn: a.checkedIn + t.checkedIn,
      noShow: a.noShow + t.noShow,
      notMarked: a.notMarked + t.notMarked,
      upcoming: a.upcoming + t.upcoming,
    }),
    { bookings: 0, vehicles: 0, checkedIn: 0, noShow: 0, notMarked: 0, upcoming: 0 },
  );
  return { byTour, totals, partialBookings, hasUpcoming: totals.upcoming > 0 };
}

// --------------------------------------------------------- cash to collect

export type CashReport = {
  /** Bookings where somebody arrived and owed something on arrival. */
  arrivedBookings: number;
  arrivedDueCents: number;
  takenByCardCents: number;
  takenByCardBookings: number;
  /** The remainder of what arrivals owed — this is the number to count against the till. */
  cashExpectedCents: number;
  noShowBookings: number;
  noShowDueCents: number;
  notMarkedBookings: number;
  notMarkedDueCents: number;
  /** Owed on tours in the range that have not run yet — not missing money, just not due. */
  upcomingBookings: number;
  upcomingDueCents: number;
};

/**
 * What the venue should be holding, and in what form.
 *
 * The split matters because the desk can now take a card through the app. A cash-only figure would
 * under-count the moment that happens and look exactly like money going missing. So what arrivals
 * owed is split into the part we can SEE — a `venue_balance` payment recorded against the booking —
 * and the remainder, which is cash.
 *
 * No-shows and unmarked bookings are reported rather than dropped. A day that does not balance is
 * usually a day somebody forgot to mark, and hiding those rows hides the explanation.
 */
export async function cashToCollect(
  locationId: string,
  from: Date,
  to: Date,
): Promise<CashReport> {
  const byBooking = foldByBooking(await linesInRange(locationId, from, to));
  const ids = [...byBooking.keys()];

  // What was taken on a card at the desk, per booking. One query, not one per booking.
  const deskPaid = new Map<string, number>();
  if (ids.length > 0) {
    const rows = await getDb()
      .select({
        bookingId: payments.bookingId,
        cents: sql<number>`coalesce(sum(${payments.amountCents} - ${payments.refundedAmountCents}), 0)::int`,
      })
      .from(payments)
      .where(
        and(
          inArray(payments.bookingId, ids),
          eq(payments.kind, "venue_balance"),
          eq(payments.status, "succeeded"),
        ),
      )
      .groupBy(payments.bookingId);
    for (const r of rows) deskPaid.set(r.bookingId, r.cents);
  }

  const out: CashReport = {
    arrivedBookings: 0,
    arrivedDueCents: 0,
    takenByCardCents: 0,
    takenByCardBookings: 0,
    cashExpectedCents: 0,
    noShowBookings: 0,
    noShowDueCents: 0,
    notMarkedBookings: 0,
    notMarkedDueCents: 0,
    upcomingBookings: 0,
    upcomingDueCents: 0,
  };
  const now = Date.now();

  for (const [bookingId, { row, lines }] of byBooking.entries()) {
    const status: CheckInRollup = bookingRollup(lines);
    const card = deskPaid.get(bookingId) ?? 0;
    // A desk card payment has already reduced `balance_due_cents`, so what the booking owed ON
    // ARRIVAL is the balance still showing plus whatever the card took.
    const dueOnArrival = (row.balanceDueCents ?? 0) + card;
    if (dueOnArrival <= 0 && card <= 0) continue;

    if (status === "not_yet") {
      // A tour that has not run yet is not an unmarked booking — nothing has happened to it. Lumping
      // the two together made every range containing today look like a pile of unexplained money.
      if (row.startsAt.getTime() > now) {
        out.upcomingBookings += 1;
        out.upcomingDueCents += dueOnArrival;
      } else {
        out.notMarkedBookings += 1;
        out.notMarkedDueCents += dueOnArrival;
      }
      continue;
    }
    if (status === "no_show") {
      out.noShowBookings += 1;
      out.noShowDueCents += dueOnArrival;
      continue;
    }
    // checked_in or partial — somebody arrived, so this was collectable.
    out.arrivedBookings += 1;
    out.arrivedDueCents += dueOnArrival;
    if (card > 0) {
      out.takenByCardBookings += 1;
      out.takenByCardCents += card;
    }
  }
  out.cashExpectedCents = Math.max(0, out.arrivedDueCents - out.takenByCardCents);
  return out;
}

// ------------------------------------------------------------ sales by user

export type SalesByUserRow = {
  userId: string | null;
  bookings: number;
  vehicles: number;
  salesCents: number;
};

/**
 * Who took which bookings, on the date they were MADE.
 *
 * `created_by_user_id` is null for anything a customer booked themselves, which is most of the
 * volume. Reported as its own row rather than dropped, so a person's share is a share of everything
 * rather than of some unstated subset.
 *
 * Two queries merged in JS, deliberately: joining `booking_lines` for the vehicle count multiplies
 * the booking rows, so summing money across that join double-counts it. Anyone "optimising" this
 * back into a single join will silently inflate every revenue figure on the page.
 */
export async function salesByUser(
  locationId: string,
  from: Date,
  to: Date,
): Promise<SalesByUserRow[]> {
  const db = getDb();
  // `bookings.created_at` is a naked `timestamp` holding UTC, compared against UTC instants — the
  // same way `bookingsTaken` does it.
  const where = and(
    eq(bookings.locationId, locationId),
    eq(bookings.status, "active"),
    // Imports are excluded, matching `bookingsTaken` — they were taken by the previous system, and
    // they all share the cutover date, so including them dumps 600+ bookings into the "self-serve"
    // row of whatever range covers migration and buries everything a person actually sold.
    ne(bookings.source, "api"),
    gte(bookings.createdAt, from),
    lt(bookings.createdAt, to),
  );

  const [money, units] = await Promise.all([
    db
      .select({
        userId: bookings.createdByUserId,
        bookings: sql<number>`count(*)::int`,
        // `total − fee − tax`, the identity documented on `BookingsReport` and used by every other
        // revenue query. `subtotal − discount` looks equivalent and is not: `subtotal_cents` holds
        // the RACK-RATE line sum on a custom-priced booking, so a rep was credited with the price
        // before their own override, and on FareHarbor imports the subtotal falls back to the total
        // and overstates by the tax. Two reports disagreeing about the same range is worse than
        // either being slightly off.
        salesCents: sql<number>`coalesce(sum(${bookings.totalCents} - ${bookings.platformFeeCents} - ${bookings.taxCents}), 0)::int`,
      })
      .from(bookings)
      .where(where)
      .groupBy(bookings.createdByUserId),
    db
      .select({
        userId: bookings.createdByUserId,
        vehicles: sql<number>`coalesce(sum(${bookingLines.quantity}), 0)::int`,
      })
      .from(bookings)
      .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
      .where(where)
      .groupBy(bookings.createdByUserId),
  ]);

  const SELF = "__self_serve__";
  const byUser = new Map<string, SalesByUserRow>();
  for (const m of money) {
    byUser.set(m.userId ?? SELF, {
      userId: m.userId,
      bookings: m.bookings,
      vehicles: 0,
      salesCents: m.salesCents,
    });
  }
  for (const u of units) {
    const hit = byUser.get(u.userId ?? SELF);
    if (hit) hit.vehicles = u.vehicles;
  }
  return [...byUser.values()].sort((a, b) => b.salesCents - a.salesCents);
}

// ------------------------------------------------------- upsells at the desk

export type UpsellRow = {
  userId: string | null;
  additions: number;
  vehicles: number;
  addedCents: number;
  /** Additions from before the value was recorded, so `addedCents` understates them. */
  unvalued: number;
};

/**
 * Vehicles and riders added to an EXISTING booking, by whoever added them.
 *
 * This is real selling — "do you want one more ATV" with the customer already at the desk — and it
 * was invisible. An addition raises the booking's subtotal but leaves nothing on the booking saying
 * who caused it, so `salesByUser` credited it to whoever created the booking days earlier, or to
 * nobody at all when the booking came in online.
 *
 * The audit log is the only record of who, which is why this reads from there rather than from
 * `bookings`. `payload.addedCents` was added 2026-08-25; earlier rows carry a quantity but no value
 * and are counted separately rather than valued at zero — a silent zero would read as "sold
 * nothing", which is the opposite of what happened.
 */
export async function upsellsByUser(
  locationId: string,
  from: Date,
  to: Date,
): Promise<UpsellRow[]> {
  const rows = await getDb()
    .select({ userId: auditLog.userId, payload: auditLog.payload })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.locationId, locationId),
        inArray(auditLog.action, ["catalog.booking.add_vehicles", "catalog.booking.add_line"]),
        // `audit_log.created_at` is a naked `timestamp` holding UTC, compared against UTC instants —
        // the same way `bookingsTaken` treats `bookings.created_at`.
        gte(auditLog.createdAt, from),
        lt(auditLog.createdAt, to),
      ),
    );

  const UNATTRIBUTED = "__unattributed__";
  const byUser = new Map<string, UpsellRow>();
  for (const r of rows) {
    const key = r.userId ?? UNATTRIBUTED;
    const hit =
      byUser.get(key) ?? { userId: r.userId, additions: 0, vehicles: 0, addedCents: 0, unvalued: 0 };
    const p = (r.payload ?? {}) as { qty?: unknown; addedCents?: unknown };
    hit.additions += 1;
    hit.vehicles += typeof p.qty === "number" ? p.qty : 0;
    if (typeof p.addedCents === "number") hit.addedCents += p.addedCents;
    else hit.unvalued += 1;
    byUser.set(key, hit);
  }
  return [...byUser.values()].sort((a, b) => b.addedCents - a.addedCents);
}

// ------------------------------------------------------------------- CSV

export type CheckInCsvRow = {
  displayNumber: string;
  itemName: string;
  startsAt: Date;
  vehicles: number;
  checkedIn: number;
  noShow: number;
  status: CheckInRollup;
};

export async function checkInRowsForCsv(
  locationId: string,
  from: Date,
  to: Date,
): Promise<CheckInCsvRow[]> {
  const byBooking = foldByBooking(await linesInRange(locationId, from, to));
  const out: CheckInCsvRow[] = [];
  for (const { row, lines } of byBooking.values()) {
    const { qty, ci, ns } = sumUnits(lines);
    out.push({
      displayNumber: row.displayNumber,
      itemName: row.itemName,
      startsAt: row.startsAt,
      vehicles: qty,
      checkedIn: ci,
      noShow: ns,
      status: bookingRollup(lines),
    });
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}


// ------------------------------------------------------------------ no-shows

export type NoShowRow = {
  bookingId: string;
  displayNumber: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  itemName: string;
  /** The slot they were booked on and missed — date AND time, which is the point. */
  startsAt: Date;
  vehicles: number;
  noShowUnits: number;
  checkedInUnits: number;
  /**
   * Some units arrived and some were marked no-show. Oscar's "arrived but marked no-show" case: it
   * is as likely to be our record that is wrong as the customer, and it should be looked at before
   * anyone is called about a ride they took.
   */
  disputed: boolean;
  balanceDueCents: number;
  latestStatus: FollowupStatus | null;
  latestNote: string | null;
  latestAt: Date | null;
  followUpCount: number;
  /** Clerk user id of whoever logged the latest outcome. Resolved to a name by the page. */
  latestByUserId: string | null;
  /**
   * Won back, or still to chase.
   *
   * A row is keyed on the OCCURRENCE — (booking, tour it missed) — not on the booking. A booking can
   * miss, be won back, and miss again on the new date; that is two things to call about, and one
   * row per booking could never say so.
   */
  outcome: "open" | "won_back";
  /** Where it went, when `outcome` is "won_back". */
  wonBackTo: { startsAt: Date | null; itemName: string | null; movedAt: Date } | null;
  /** Full workflow state — see lib/booking/noShowCase.ts. `outcome` above is `caseState.outcome`. */
  caseState: CaseState;
};

/**
 * Every no-show in the range, with contact details and where the outreach stands.
 *
 * Built for calling people back, so it carries a name and a phone number and the original tour time —
 * a rep on the phone needs to say "you were booked on the 9pm Glow Tour on Saturday", not "booking
 * 0412".
 *
 * Latest follow-up per booking comes from SQL `DISTINCT ON` rather than sorting in JS. Not for speed:
 * "latest per group" is the exact shape people hand-roll wrongly, and getting it wrong here shows a
 * rep a stale outcome and gets a customer called twice.
 */
export async function noShowReport(
  locationId: string,
  from: Date,
  to: Date,
  /** Location timezone — decides what "due today" means for a rep in that market. */
  tz = "America/Chicago",
): Promise<NoShowRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      bookingId: bookings.id,
      displayNumber: bookings.displayNumber,
      firstName: customers.firstName,
      lastName: customers.lastName,
      phone: customers.phoneE164,
      email: customers.emailLower,
      itemName: items.name,
      startsAt: availabilities.startsAt,
      balanceDueCents: bookings.balanceDueCents,
      quantity: bookingLines.quantity,
      checkedInUnits: bookingLines.checkedInUnits,
      noShowUnits: bookingLines.noShowUnits,
    })
    .from(bookings)
    .innerJoin(availabilities, eq(availabilities.id, bookings.availabilityId))
    .innerJoin(items, eq(items.id, bookings.itemId))
    .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .leftJoin(customers, eq(customers.id, bookings.customerId))
    .where(
      and(
        eq(bookings.locationId, locationId),
        eq(bookings.status, "active"),
        gte(availabilities.startsAt, from),
        lt(availabilities.startsAt, to),
        // At least one unit marked no-show. A booking that PARTLY no-showed belongs here too — that
        // is the discrepancy worth chasing, not an edge case to filter away.
        sql`${bookingLines.noShowUnits} > 0`,
      ),
    );

  // Keyed on the OCCURRENCE. `rescheduleBooking` resets no_show_units to 0 on a move, so a booking
  // that was won back drops out of the query above entirely — the won-back occurrences are added
  // from the reschedule snapshots below, which is the only place that history survives.
  const key = (bookingId: string, missedAt: Date) =>
    `${bookingId}:${missedAt.toISOString()}`;

  const byBooking = new Map<string, NoShowRow>();
  for (const r of rows) {
    const k = key(r.bookingId, r.startsAt);
    const hit = byBooking.get(k);
    if (hit) {
      hit.vehicles += r.quantity;
      hit.noShowUnits += r.noShowUnits;
      hit.checkedInUnits += r.checkedInUnits;
    } else {
      byBooking.set(k, {
        bookingId: r.bookingId,
        displayNumber: r.displayNumber,
        customerName: [r.firstName, r.lastName].filter(Boolean).join(" ") || "—",
        phone: r.phone,
        email: r.email,
        itemName: r.itemName,
        startsAt: r.startsAt,
        vehicles: r.quantity,
        noShowUnits: r.noShowUnits,
        checkedInUnits: r.checkedInUnits,
        disputed: false,
        balanceDueCents: r.balanceDueCents ?? 0,
        latestStatus: null,
        latestNote: null,
        latestAt: null,
        followUpCount: 0,
        latestByUserId: null,
        outcome: "open",
        wonBackTo: null,
        caseState: PENDING_CASE,
      });
    }
  }
  for (const row of byBooking.values()) {
    row.disputed = row.checkedInUnits > 0 && row.noShowUnits > 0;
  }

  // Won-back occurrences, added from the reschedule snapshots.
  //
  // This is the fix for "the no-shows report says 2 and the reschedules report says 17". The old
  // count was `latestStatus === "rescheduled"` — a rep remembering to pick an outcome from a
  // dropdown, which almost nobody does: 9 such rows exist system-wide, ever. Worse, performing the
  // reschedule ZEROES no_show_units, so a genuine win-back fails this report's own predicate and
  // disappears. The "2" were bookings somebody had re-marked no-show on the NEW slot.
  const wins = await winBacks(locationId, from, to, "missed");
  const winBookingIds = [...new Set(wins.map((w) => w.bookingId))];
  const winDetail = winBookingIds.length
    ? await db
        .select({
          bookingId: bookings.id,
          displayNumber: bookings.displayNumber,
          firstName: customers.firstName,
          lastName: customers.lastName,
          phone: customers.phoneE164,
          email: customers.emailLower,
          balanceDueCents: bookings.balanceDueCents,
        })
        .from(bookings)
        .leftJoin(customers, eq(customers.id, bookings.customerId))
        .where(inArray(bookings.id, winBookingIds))
    : [];
  const detailBy = new Map(winDetail.map((d) => [d.bookingId, d]));

  // Snapshot units per occurrence — read from the reschedule row, not from booking_lines, which the
  // move has already reset.
  const winUnits = winBookingIds.length
    ? await db
        .select({
          bookingId: bookingReschedules.bookingId,
          fromStartsAt: bookingReschedules.fromStartsAt,
          createdAt: bookingReschedules.createdAt,
          fromQuantity: bookingReschedules.fromQuantity,
          fromCheckedInUnits: bookingReschedules.fromCheckedInUnits,
          fromNoShowUnits: bookingReschedules.fromNoShowUnits,
        })
        .from(bookingReschedules)
        .where(inArray(bookingReschedules.bookingId, winBookingIds))
    : [];
  const unitsBy = new Map(
    winUnits.map((u) => [
      `${u.bookingId}:${(u.fromStartsAt ?? u.createdAt).toISOString()}`,
      u,
    ]),
  );

  for (const w of wins) {
    const k = key(w.bookingId, w.missedStartsAt);
    const existing = byBooking.get(k);
    if (existing) {
      // Missed, won back, and marked no-show AGAIN on the new date. Both facts are true; the win
      // is the one worth reporting, and the fresh miss arrives as its own occurrence.
      existing.outcome = "won_back";
      existing.wonBackTo = {
        startsAt: w.toStartsAt,
        itemName: w.toItemName,
        movedAt: w.movedAt,
      };
      continue;
    }
    const d = detailBy.get(w.bookingId);
    if (!d) continue;
    const u = unitsBy.get(k);
    byBooking.set(k, {
      bookingId: w.bookingId,
      displayNumber: d.displayNumber,
      customerName: [d.firstName, d.lastName].filter(Boolean).join(" ") || "—",
      phone: d.phone,
      email: d.email,
      itemName: w.missedItemName ?? "—",
      startsAt: w.missedStartsAt,
      vehicles: u?.fromQuantity ?? 0,
      noShowUnits: u?.fromNoShowUnits ?? 0,
      checkedInUnits: u?.fromCheckedInUnits ?? 0,
      disputed: w.wasDisputed,
      balanceDueCents: d.balanceDueCents ?? 0,
      latestStatus: null,
      latestNote: null,
      latestAt: null,
      followUpCount: 0,
      latestByUserId: null,
      outcome: "won_back",
      wonBackTo: { startsAt: w.toStartsAt, itemName: w.toItemName, movedAt: w.movedAt },
      caseState: PENDING_CASE,
    });
  }

  const ids = [...new Set([...byBooking.values()].map((r) => r.bookingId))];
  if (ids.length > 0) {
    // DISTINCT ON through the query builder, not a raw `sql` template.
    //
    // The raw version read `WHERE f.booking_id = ANY(${ids})`, and drizzle expands a JS array in a
    // template into a comma-separated parameter LIST — so it became `ANY(($1, $2, …))`, which is a
    // row constructor rather than an array, and Postgres rejected the whole query. The page 500'd on
    // any range that had a no-show in it. `inArray` builds the array literal correctly.
    const latest = await db
      .selectDistinctOn([bookingFollowups.bookingId], {
        bookingId: bookingFollowups.bookingId,
        status: bookingFollowups.status,
        note: bookingFollowups.note,
        createdAt: bookingFollowups.createdAt,
        userId: bookingFollowups.userId,
      })
      .from(bookingFollowups)
      .where(inArray(bookingFollowups.bookingId, ids))
      // DISTINCT ON keeps the first row per booking, so the ordering IS the selection: booking first,
      // newest second.
      .orderBy(bookingFollowups.bookingId, desc(bookingFollowups.createdAt));

    const counts = await db
      .select({
        bookingId: bookingFollowups.bookingId,
        n: sql<number>`count(*)::int`,
      })
      .from(bookingFollowups)
      .where(inArray(bookingFollowups.bookingId, ids))
      .groupBy(bookingFollowups.bookingId);
    const countBy = new Map(counts.map((c) => [c.bookingId, c.n]));

    // Attached per BOOKING, to every occurrence of it on screen. Attempts carry no occurrence key
    // of their own; splitting them by time window is the next step, not this one.
    const latestBy = new Map(latest.map((l) => [l.bookingId, l]));
    for (const row of byBooking.values()) {
      const l = latestBy.get(row.bookingId);
      if (!l) continue;
      row.latestStatus = l.status as FollowupStatus;
      row.latestNote = l.note;
      row.latestAt = l.createdAt;
      row.latestByUserId = l.userId;
      row.followUpCount = countBy.get(row.bookingId) ?? 1;
    }
  }

  // ---- workflow state -------------------------------------------------------------------------
  //
  // Everything is derived: attempts from the follow-up rows, won-back from the move, refusal from
  // EXISTS over the statuses. `no_show_cases` supplies only the two things that cannot be — a due
  // date and a manual close — and rows there are created lazily, so most occurrences have none.
  const occurrenceIds = [...byBooking.values()];
  const caseRows = ids.length
    ? await db
        .select()
        .from(noShowCases)
        .where(inArray(noShowCases.bookingId, ids))
    : [];
  const caseBy = new Map(
    caseRows.map((c) => [key(c.bookingId, c.forStartsAt), c]),
  );

  const allFollowUps = ids.length
    ? await db
        .select({
          bookingId: bookingFollowups.bookingId,
          status: bookingFollowups.status,
          createdAt: bookingFollowups.createdAt,
        })
        .from(bookingFollowups)
        .where(inArray(bookingFollowups.bookingId, ids))
    : [];
  const followBy = new Map<string, { status: string; createdAt: Date }[]>();
  for (const f of allFollowUps) {
    const list = followBy.get(f.bookingId);
    if (list) list.push(f);
    else followBy.set(f.bookingId, [f]);
  }

  const now = new Date();
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  for (const row of occurrenceIds) {
    const k = key(row.bookingId, row.startsAt);
    row.caseState = resolveCase(
      {
        wonBack: row.outcome === "won_back",
        followUps: followBy.get(row.bookingId) ?? [],
        caseRow: caseBy.get(k) ?? null,
        missedStartsAt: row.startsAt,
      },
      now,
      dayKey,
    );
    row.followUpCount = (followBy.get(row.bookingId) ?? []).length;
  }

  // Overdue first, then today's commitments, then never-contacted. Within a bucket the old rule
  // stands: oldest missed tour first.
  return occurrenceIds.sort(
    (a, b) =>
      BUCKET_ORDER[a.caseState.bucket] - BUCKET_ORDER[b.caseState.bucket] ||
      a.startsAt.getTime() - b.startsAt.getTime(),
  );
}

// ------------------------------------------------------------ win-backs

/**
 * Win-backs are only identifiable from this date, when a move started snapshotting the booking's
 * check-in state onto the reschedule row. Before it `from_no_show_units` defaulted to 0, so every
 * earlier move reads as "not a win-back" — which is UNKNOWN, not zero. Measured: 128 rows before,
 * 0 apparent win-backs; 219 rows after, 28 real ones.
 */
/** Placeholder until `resolveCase` runs at the end of `noShowReport`. Never leaves the function. */
const PENDING_CASE: CaseState = {
  outcome: "open",
  bucket: "new",
  attempts: 0,
  nextFollowUpAt: null,
  isClosed: false,
};

export const WIN_BACK_RECORDED_FROM = new Date("2026-08-25T00:00:00.000Z");

export type WinBack = {
  rescheduleId: string;
  bookingId: string;
  /** The tour they did not turn up for. THE identity of the occurrence, with bookingId. */
  missedStartsAt: Date;
  missedItemName: string | null;
  /** When a human clicked Reschedule. */
  movedAt: Date;
  toStartsAt: Date | null;
  toItemName: string | null;
  performedByUserId: string | null;
  /** Units had partly checked in as well, so the original no-show was already in question. */
  wasDisputed: boolean;
};

/**
 * THE definition of a win-back. Both reports call this; nothing else decides.
 *
 * A win-back is a booking that had units marked no-show and was then moved to a new slot. It is
 * derived from the move itself, never from a rep remembering to log an outcome — which is what the
 * no-shows report used to require, and why it reported 2 against a real 17 for Houston in one week.
 * Only 9 `status='rescheduled'` follow-ups exist system-wide, ever.
 *
 * ## Why the two reports still show different numbers, legitimately
 *
 * They run on different clocks, and the registry says so: the no-shows report is `basis: tour_date`,
 * the reschedules report is `basis: action_date`. A tour missed on the 24th and won back on the 2nd
 * of the next month belongs in one window and not the other. Forcing the counts equal would mean
 * putting one report on the other's clock and breaking every other tile on that page. What must be
 * shared is this predicate — and it now is.
 *
 * Group moves are excluded: `moveSlotBookings` sweeps every booking off a slot the operator has
 * cancelled, and those guests were not persuaded back by anyone. Excluded by `kind`, never by
 * matching the reason string, which a reword would silently break in the direction of inflating wins.
 */
export async function winBacks(
  locationId: string,
  from: Date,
  to: Date,
  /** "missed" ranges on the tour they missed; "moved" ranges on when the move happened. */
  basis: "missed" | "moved",
): Promise<WinBack[]> {
  // 4 rows predate `from_starts_at` being written; fall back to the move time so they are neither
  // dropped nor dated to 1970.
  const missedAt = sql<Date>`coalesce(${bookingReschedules.fromStartsAt}, ${bookingReschedules.createdAt})`;
  const rangeCol = basis === "missed" ? missedAt : bookingReschedules.createdAt;

  const rows = await getDb()
    .select({
      rescheduleId: bookingReschedules.id,
      bookingId: bookingReschedules.bookingId,
      missedStartsAt: missedAt,
      missedItemName: bookingReschedules.fromItemName,
      movedAt: bookingReschedules.createdAt,
      toStartsAt: bookingReschedules.toStartsAt,
      toItemName: bookingReschedules.toItemName,
      performedByUserId: bookingReschedules.performedByUserId,
      fromCheckedInUnits: bookingReschedules.fromCheckedInUnits,
    })
    .from(bookingReschedules)
    .innerJoin(bookings, eq(bookings.id, bookingReschedules.bookingId))
    .where(
      and(
        eq(bookings.locationId, locationId),
        gt(bookingReschedules.fromNoShowUnits, 0),
        ne(bookingReschedules.kind, "group_move"),
        sql`${rangeCol} >= ${from}`,
        sql`${rangeCol} < ${to}`,
      ),
    );

  return rows.map((r) => ({
    rescheduleId: r.rescheduleId,
    bookingId: r.bookingId,
    missedStartsAt: new Date(r.missedStartsAt),
    missedItemName: r.missedItemName,
    movedAt: r.movedAt,
    toStartsAt: r.toStartsAt,
    toItemName: r.toItemName,
    performedByUserId: r.performedByUserId,
    wasDisputed: r.fromCheckedInUnits > 0,
  }));
}

export type RescheduleRow = {
  id: string;
  bookingId: string;
  displayNumber: string;
  customerName: string;
  phone: string | null;
  fromStartsAt: Date | null;
  fromItemName: string | null;
  toStartsAt: Date | null;
  toItemName: string | null;
  /**
   * The booking had units marked no-show before this move — a win-back.
   *
   * Group moves are excluded even when the counts look like a win-back: the operator eliminated the
   * slot, nobody was persuaded back. See `winBacks`.
   */
  wasNoShow: boolean;
  /** Why the booking moved — `group_move` is an operator sweeping a cancelled slot. */
  kind: "customer" | "group_move" | "system";
  /** It had partly checked in as well, so the original no-show was already in question. */
  wasDisputed: boolean;
  feeChargedCents: number;
  reason: string | null;
  performedByUserId: string | null;
  createdAt: Date;
};

/**
 * Every move in the range, with the win-backs first.
 *
 * Reads the snapshot columns and joins NOTHING to `availabilities` — which is the whole point. The
 * pointers are nullable now and old slots do get cleaned off the schedule; a report that joined
 * through them would quietly thin out over exactly the period a win-back trend needs.
 *
 * Ranged on when the MOVE happened, not on either tour date. "What did the team win back last week"
 * is a question about the team's week.
 */
export async function rescheduleReport(
  locationId: string,
  from: Date,
  to: Date,
): Promise<RescheduleRow[]> {
  const rows = await getDb()
    .select({
      id: bookingReschedules.id,
      bookingId: bookingReschedules.bookingId,
      displayNumber: bookings.displayNumber,
      firstName: customers.firstName,
      lastName: customers.lastName,
      phone: customers.phoneE164,
      fromStartsAt: bookingReschedules.fromStartsAt,
      fromItemName: bookingReschedules.fromItemName,
      toStartsAt: bookingReschedules.toStartsAt,
      toItemName: bookingReschedules.toItemName,
      fromCheckedInUnits: bookingReschedules.fromCheckedInUnits,
      fromNoShowUnits: bookingReschedules.fromNoShowUnits,
      kind: bookingReschedules.kind,
      feeChargedCents: bookingReschedules.feeChargedCents,
      reason: bookingReschedules.reason,
      performedByUserId: bookingReschedules.performedByUserId,
      createdAt: bookingReschedules.createdAt,
    })
    .from(bookingReschedules)
    .innerJoin(bookings, eq(bookings.id, bookingReschedules.bookingId))
    .leftJoin(customers, eq(customers.id, bookings.customerId))
    .where(
      and(
        eq(bookings.locationId, locationId),
        gte(bookingReschedules.createdAt, from),
        lt(bookingReschedules.createdAt, to),
      ),
    );

  return rows
    .map((r) => ({
      id: r.id,
      bookingId: r.bookingId,
      displayNumber: r.displayNumber,
      customerName: [r.firstName, r.lastName].filter(Boolean).join(" ") || "—",
      phone: r.phone,
      fromStartsAt: r.fromStartsAt,
      fromItemName: r.fromItemName,
      toStartsAt: r.toStartsAt,
      toItemName: r.toItemName,
      // Same predicate as `winBacks`, so the tile on this page and the tile on the no-shows page
      // cannot disagree about what a win-back IS. They still range on different clocks, by design.
      wasNoShow: r.fromNoShowUnits > 0 && r.kind !== "group_move",
      kind: r.kind,
      wasDisputed:
        r.fromNoShowUnits > 0 && r.kind !== "group_move" && r.fromCheckedInUnits > 0,
      feeChargedCents: r.feeChargedCents,
      reason: r.reason,
      performedByUserId: r.performedByUserId,
      createdAt: r.createdAt,
    }))
    // Win-backs lead — they are what the report is for; everything else is context.
    .sort((a, b) => {
      if (a.wasNoShow !== b.wasNoShow) return a.wasNoShow ? -1 : 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
}

// ------------------------------------------------------------ win-back revenue

export type WinBackRevenue = {
  /** Distinct bookings behind the figures. Occurrences can exceed this — a booking can miss twice. */
  bookings: number;
  /** Came back and rode. Partial check-ins prorated by units. */
  recoveredCents: number;
  /** Came back, tour still ahead of them, nothing marked yet. */
  upcomingCents: number;
  /** Moved and then no-showed again, was cancelled, or the new tour ran unmarked. */
  lostAgainCents: number;
};

/**
 * What the win-backs in a range are worth.
 *
 * ⚠️ These are CURRENT values, not what was at risk. A cross-tour move overwrites the booking's
 * subtotal and total in place and `syncPlatformFee` rewrites the fee, so "what it was worth when
 * they failed to turn up" is unrecoverable for anything moved before migration 0043 — which is every
 * row on file today. The `from_*_cents` snapshot starts filling from now; the page says so.
 *
 * Two queries merged in JS rather than one join, deliberately. Joining `booking_lines` for unit
 * counts multiplies the booking row and double-counts the money — the mistake `salesByUser` documents
 * and avoids, and the reason the revenue identity `total − platform_fee − tax` is computed on
 * `bookings` alone.
 *
 * Counted per BOOKING, not per occurrence: #0742 has two win-back rows but one current price, and
 * summing per row would bill it twice. The occurrence COUNT stays separate.
 */
export async function winBackRevenue(
  locationId: string,
  from: Date,
  to: Date,
  basis: "missed" | "moved",
): Promise<WinBackRevenue> {
  const wins = await winBacks(locationId, from, to, basis);
  const ids = [...new Set(wins.map((w) => w.bookingId))];
  const empty = { bookings: 0, recoveredCents: 0, upcomingCents: 0, lostAgainCents: 0 };
  if (ids.length === 0) return empty;

  const db = getDb();
  const money = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      startsAt: availabilities.startsAt,
      netCents: sql<number>`(${bookings.totalCents} - ${bookings.platformFeeCents} - ${bookings.taxCents})::int`,
    })
    .from(bookings)
    .innerJoin(availabilities, eq(availabilities.id, bookings.availabilityId))
    .where(inArray(bookings.id, ids));

  const units = await db
    .select({
      bookingId: bookingLines.bookingId,
      q: sql<number>`sum(${bookingLines.quantity})::int`,
      c: sql<number>`sum(${bookingLines.checkedInUnits})::int`,
      n: sql<number>`sum(${bookingLines.noShowUnits})::int`,
    })
    .from(bookingLines)
    .where(inArray(bookingLines.bookingId, ids))
    .groupBy(bookingLines.bookingId);
  const unitBy = new Map(units.map((u) => [u.bookingId, u]));

  const now = Date.now();
  const out = { ...empty, bookings: money.length };
  for (const b of money) {
    const u = unitBy.get(b.id);
    const q = u?.q ?? 0;
    const c = u?.c ?? 0;
    const roll = bookingRollup([{ quantity: q, checkedInUnits: c, noShowUnits: u?.n ?? 0 }]);
    const net = b.netCents ?? 0;

    if (b.status !== "active") {
      out.lostAgainCents += net;
    } else if (roll === "checked_in") {
      out.recoveredCents += net;
    } else if (roll === "partial") {
      // Prorated by units rather than counted whole or dropped. The page already treats a partial
      // as the interesting case (it is what `disputed` is), so rounding it to 0 or 100% would
      // contradict the rest of the report.
      const share = q > 0 ? Math.round((net * c) / q) : 0;
      out.recoveredCents += share;
      out.lostAgainCents += net - share;
    } else if (roll === "no_show") {
      out.lostAgainCents += net;
    } else if (b.startsAt.getTime() >= now) {
      out.upcomingCents += net;
    } else {
      // Tour has run and nobody marked it either way. Not recovered — a desk miss, not a ride.
      out.lostAgainCents += net;
    }
  }
  return out;
}
