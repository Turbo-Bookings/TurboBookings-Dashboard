import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  availabilities,
  bookingLines,
  bookings,
  getDb,
  items,
  payments,
} from "@/lib/db";
import { bookingRollup, type CheckInRollup } from "@/lib/data/bookings";

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
  /** Units nobody marked either way. */
  notMarked: number;
};

export type CheckInReport = {
  byTour: CheckInTourRow[];
  totals: Omit<CheckInTourRow, "itemName">;
  /** Bookings where some units checked in AND some were marked no-show — worth a look. */
  partialBookings: number;
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

  for (const { row, lines } of byBooking.values()) {
    const t = tours.get(row.itemName) ?? {
      itemName: row.itemName,
      bookings: 0,
      vehicles: 0,
      checkedIn: 0,
      noShow: 0,
      notMarked: 0,
    };
    const { qty, ci, ns } = sumUnits(lines);
    t.bookings += 1;
    t.vehicles += qty;
    t.checkedIn += ci;
    t.noShow += ns;
    t.notMarked += Math.max(0, qty - ci - ns);
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
    }),
    { bookings: 0, vehicles: 0, checkedIn: 0, noShow: 0, notMarked: 0 },
  );
  return { byTour, totals, partialBookings };
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
  };

  for (const [bookingId, { row, lines }] of byBooking.entries()) {
    const status: CheckInRollup = bookingRollup(lines);
    const card = deskPaid.get(bookingId) ?? 0;
    // A desk card payment has already reduced `balance_due_cents`, so what the booking owed ON
    // ARRIVAL is the balance still showing plus whatever the card took.
    const dueOnArrival = (row.balanceDueCents ?? 0) + card;
    if (dueOnArrival <= 0 && card <= 0) continue;

    if (status === "not_yet") {
      out.notMarkedBookings += 1;
      out.notMarkedDueCents += dueOnArrival;
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
    gte(bookings.createdAt, from),
    lt(bookings.createdAt, to),
  );

  const [money, units] = await Promise.all([
    db
      .select({
        userId: bookings.createdByUserId,
        bookings: sql<number>`count(*)::int`,
        salesCents: sql<number>`coalesce(sum(${bookings.subtotalCents} - ${bookings.discountCents}), 0)::int`,
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
