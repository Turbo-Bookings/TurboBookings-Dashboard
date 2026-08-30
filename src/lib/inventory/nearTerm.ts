import "server-only";
import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import { overlappingResourceUsage } from "@/lib/availability/resourceUsage";
import { bestTypeRemaining, fixedRemaining, slotRemaining } from "@/lib/booking/capacity";
import { poolsAndRequirementsForItems, withUsage } from "@/lib/booking/pools";
import {
  availabilities,
  availabilitySchedules,
  bookingLines,
  bookings,
  getDb,
  items,
} from "@/lib/db";
import { DAYPARTS, type Daypart, type Dow, daypartForHour } from "./dayparts";

// What is still sellable over the next few days — the NEAR-TERM half of the feed.
//
// Clones `gridForDate`'s batching (4 queries regardless of slot count) but over the whole horizon
// rather than one day, and keeps its seat-holds branch: a unit held in someone's open checkout
// genuinely cannot be sold right now.
//
// ## ⚠️ Emptiness here is the NORMAL state, not a demand signal
//
// Median booking lead time is under a day in Houston and Miami and under two in Dallas. A slot three
// days out is empty because nobody has booked it YET. Read as weak demand it becomes an argument to
// scale into nothing, or to cut a market that is performing perfectly well.
//
// Only the POSITIVE reading is actionable in the near term: today or tomorrow at capacity. Every day
// beyond the first carries `lowFillIsNotADemandSignal: true` so the flag travels with the number
// rather than living only in a prompt someone may trim.
//
// ## ⚠️ Remaining units are NEVER additive across slots
//
// Nine Dallas slots each reporting 22 free is not 198 sellable units — the slots share one pool of 22
// machines, so at any instant at most 22 are available. `sellableUnitsUpperBound` is named for what it
// is; `maxSellableUnitsSingleSlot` is the figure that can actually be committed to.

export type NearTermDaypart = {
  daypart: Daypart;
  slotsRemaining: number;
  slotsSoldOut: number;
  unitsBooked: number;
  maxSellableUnitsSingleSlot: number;
};

export type NearTermDay = {
  localDate: string;
  dow: Dow;
  offsetDays: number;
  slotsTotal: number;
  /** Already started. Not empty — gone. Kept separate so today is not diluted by the morning. */
  slotsDeparted: number;
  slotsRemaining: number;
  slotsSoldOut: number;
  slotsSellable: number;
  unitsBooked: number;
  maxSellableUnitsSingleSlot: number;
  /** Sum over remaining slots. An UPPER BOUND — slots share pools. Never additive capacity. */
  sellableUnitsUpperBound: number;
  firstSellableSlotLocal: string | null;
  lowFillIsNotADemandSignal: boolean;
  dayparts: NearTermDaypart[];
};

export type NearTermResult = {
  basis: "serviceable";
  horizonDays: number;
  asOfLocal: string;
  days: NearTermDay[];
};

export async function nearTermInventory(
  locationId: string,
  tz: string,
  now: Date,
  horizonDays: number,
): Promise<NearTermResult> {
  const db = getDb();
  const zone = tz || "utc";
  const asOfLocal = DateTime.fromJSDate(now, { zone });
  const dayStart = asOfLocal.startOf("day");
  const start = dayStart.toUTC().toJSDate();
  const end = dayStart.plus({ days: horizonDays + 1 }).toUTC().toJSDate();

  // 1 — every slot in the horizon.
  const slots = await db
    .select({
      a: availabilities,
      capacityMode: items.capacityMode,
      schedCap: availabilitySchedules.capacityPerSlot,
    })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .leftJoin(availabilitySchedules, eq(availabilities.scheduleId, availabilitySchedules.id))
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, start),
        lt(availabilities.startsAt, end),
        // Not sellable if explicitly closed — Dallas's retimed Glow slots are exactly that case:
        // still present so their existing guests can check in, deliberately unsellable.
        //
        // `ne(..., "off")` and NOT `eq(..., "on")`: the default is `auto` (follow the schedule), which
        // is what almost every slot actually carries. Matching only "on" silently dropped nearly all
        // inventory — Dallas showed 3 slots on a Saturday that really has a dozen.
        // Same predicate `openSlotsForItem` uses, deliberately.
        ne(availabilities.onlineBookingStatus, "off"),
      ),
    )
    .orderBy(asc(availabilities.startsAt));

  const emptyResult: NearTermResult = {
    basis: "serviceable",
    horizonDays,
    asOfLocal: asOfLocal.toISO()!,
    days: [],
  };
  if (slots.length === 0) return emptyResult;

  // 2 — booked units per slot.
  const slotIds = slots.map((s) => s.a.id);
  const bookedRows = await db
    .select({ availabilityId: bookings.availabilityId, qty: bookingLines.quantity })
    .from(bookings)
    .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .where(and(inArray(bookings.availabilityId, slotIds), eq(bookings.status, "active")));
  const bookedBySlot = new Map<string, number>();
  for (const r of bookedRows)
    bookedBySlot.set(r.availabilityId, (bookedBySlot.get(r.availabilityId) ?? 0) + r.qty);

  // 3 — resource pools + per-customer-type requirements per resource-based item. Kept raw rather
  // than collapsed per resource: a tour selling from two ALTERNATIVE pools (Miami's 2-Seat and
  // 4-Seat UTVs) has no single "units remaining", and collapsing let the scarcer pool cap the tour.
  const resourceItemIds = [
    ...new Set(slots.filter((s) => s.capacityMode === "resource_based").map((s) => s.a.itemId)),
  ];
  const capacityByItem = await poolsAndRequirementsForItems(resourceItemIds);

  // 4 — shared-pool usage, ONE query for every slot in the horizon. Peak concurrent, never a sum.
  const usage = resourceItemIds.length
    ? await overlappingResourceUsage(
        slots.map((s) => ({ id: s.a.id, startsAt: s.a.startsAt, endsAt: s.a.endsAt })),
        locationId,
      )
    : new Map();

  type DayAcc = {
    localDate: string;
    dow: Dow;
    offsetDays: number;
    slotsTotal: number;
    slotsDeparted: number;
    slotsRemaining: number;
    slotsSoldOut: number;
    slotsSellable: number;
    unitsBooked: number;
    maxSingle: number;
    upperBound: number;
    firstSellable: DateTime | null;
    parts: Map<Daypart, NearTermDaypart>;
  };
  const byDay = new Map<string, DayAcc>();

  for (const s of slots) {
    const local = DateTime.fromJSDate(s.a.startsAt, { zone });
    const localDate = local.toISODate()!;
    let d = byDay.get(localDate);
    if (!d) {
      d = {
        localDate,
        dow: (local.weekday % 7) as Dow,
        offsetDays: Math.round(local.startOf("day").diff(dayStart, "days").days),
        slotsTotal: 0,
        slotsDeparted: 0,
        slotsRemaining: 0,
        slotsSoldOut: 0,
        slotsSellable: 0,
        unitsBooked: 0,
        maxSingle: 0,
        upperBound: 0,
        firstSellable: null,
        parts: new Map(),
      };
      byDay.set(localDate, d);
    }

    const booked = bookedBySlot.get(s.a.id) ?? 0;
    d.slotsTotal += 1;
    d.unitsBooked += booked;

    // A slot that has already started is gone, not empty. Counting it as unsold inventory would make
    // every afternoon look like collapsing demand.
    if (s.a.startsAt <= now) {
      d.slotsDeparted += 1;
      continue;
    }
    d.slotsRemaining += 1;

    const slotUsage = usage.get(s.a.id);
    // Two different questions, and they are not the same number once a tour sells from more than
    // one pool. `available` is how many more units could be sold in total; `anySellable` is whether
    // ANYTHING can be sold. A tour with three free two-seaters and a dead four-seater has
    // available = 3 and is emphatically not sold out — the old single scalar said 0 to both.
    let available: number | null;
    let anySellable: number;
    if (s.capacityMode === "fixed") {
      const base = s.a.capacityOverride ?? s.schedCap;
      available = base != null ? fixedRemaining(base, booked) : null;
      anySellable = available ?? 0;
    } else {
      const cap = capacityByItem.get(s.a.itemId);
      if (!cap) {
        available = null;
        anySellable = 0;
      } else {
        const live = withUsage(cap.pools, slotUsage);
        available = slotRemaining(live, cap.requirements);
        anySellable = bestTypeRemaining(live, cap.requirements);
      }
    }

    const free = available ?? 0;
    if (available != null && anySellable <= 0) d.slotsSoldOut += 1;
    if (anySellable > 0) {
      d.slotsSellable += 1;
      if (!d.firstSellable || local < d.firstSellable) d.firstSellable = local;
    }
    d.maxSingle = Math.max(d.maxSingle, free);
    d.upperBound += free;

    const daypart = daypartForHour(local.hour);
    let p = d.parts.get(daypart);
    if (!p) {
      p = {
        daypart,
        slotsRemaining: 0,
        slotsSoldOut: 0,
        unitsBooked: 0,
        maxSellableUnitsSingleSlot: 0,
      };
      d.parts.set(daypart, p);
    }
    p.slotsRemaining += 1;
    p.unitsBooked += booked;
    if (available != null && free <= 0) p.slotsSoldOut += 1;
    p.maxSellableUnitsSingleSlot = Math.max(p.maxSellableUnitsSingleSlot, free);
  }

  const days = [...byDay.values()]
    .sort((a, b) => a.localDate.localeCompare(b.localDate))
    .map<NearTermDay>((d) => ({
      localDate: d.localDate,
      dow: d.dow,
      offsetDays: d.offsetDays,
      slotsTotal: d.slotsTotal,
      slotsDeparted: d.slotsDeparted,
      slotsRemaining: d.slotsRemaining,
      slotsSoldOut: d.slotsSoldOut,
      slotsSellable: d.slotsSellable,
      unitsBooked: d.unitsBooked,
      maxSellableUnitsSingleSlot: d.maxSingle,
      sellableUnitsUpperBound: d.upperBound,
      firstSellableSlotLocal: d.firstSellable ? d.firstSellable.toISO() : null,
      // Only today can be read as "quiet". Everything further out has not had its booking window yet.
      lowFillIsNotADemandSignal: d.offsetDays >= 1,
      dayparts: DAYPARTS.map((name) => d.parts.get(name)).filter(
        (p): p is NearTermDaypart => p != null,
      ),
    }));

  return { basis: "serviceable", horizonDays, asOfLocal: asOfLocal.toISO()!, days };
}
