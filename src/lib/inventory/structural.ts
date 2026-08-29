import "server-only";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { peakConcurrent } from "@/lib/availability/resourceUsage";
import { getDb, availabilities, bookings, items } from "@/lib/db";
import {
  DAYPARTS,
  DAYPART_HOURS,
  DOW_NAMES,
  type Daypart,
  type Dow,
  cellKey,
  daypartForHour,
} from "./dayparts";
import { fleetForLocation, type FleetPool } from "./fleet";

// Realised historical utilisation per tour day-of-week × daypart — the STRUCTURAL half of the feed.
//
// This is the signal that answers "which periods can absorb more demand", and it is the only half that
// can support that claim. Near-term fill cannot: with a median booking lead time under two days, a slot
// three days out is empty because nobody has booked it YET, not because nobody wants it.
//
// ## Why this is not `gridForDate` in a loop
//
// `gridForDate` is the right tool for a FUTURE day and the wrong one for a past day, three times over:
//
//   1. It computes `remaining`. For a date that has already run, "remaining" is meaningless — the
//      question is what was actually consumed.
//   2. It unions in `seat_holds WHERE expires_at > now()`. Live checkout holds are correct for
//      near-term sellability and pure noise in history.
//   3. It applies TODAY's `out_of_service_count`, which would retroactively rewrite every past
//      Saturday the moment a machine goes into the shop. See `fleet.ts`.
//
// It is also 84 days × 4 queries × 3 locations = ~1,000 queries an hour. This does the whole window in
// two.
//
// ## Two measures, because one alone misleads
//
//   * `peakFleetPct` — peak simultaneous units out, over nameplate. Answers "was it PHYSICALLY full at
//     some instant?" This is what "6 of 15 Saturday slots ran ≥90% of fleet" means.
//   * `fillPct` — machine-hours sold over machine-hours OFFERED. Answers "of what we opened, what did
//     we sell?"
//
// A market can be 100% peak-full for ten minutes and 5% filled overall. Shipping only the first invites
// "we're maxed out"; only the second invites "there's loads of room" on a day that turns riders away.

const LOOKBACK_DAYS = 84; // 12 whole weeks — every weekday gets equal representation. 90 would not.
const SATURATION_PCT = 90;
const THIN_CELL_MIN_DAYS = 4;

export type StructuralCell = {
  dow: Dow;
  dowName: string;
  daypart: Daypart;
  daysObserved: number;
  slotsObserved: number;
  peakFleetPctMean: number;
  peakFleetPctMax: number;
  /**
   * Peak units out, in ABSOLUTE machines, alongside the percentages.
   *
   * Percentages here are against NAMEPLATE, which is the only stable historical denominator (see
   * `fleet.ts`) — but that makes saturation look milder than it felt at the time. Dallas's busiest
   * Saturday put 24 ATVs out: 89% of the 27 nameplate, but 109% of the 22 currently serviceable. Both
   * readings are defensible and neither is safe alone, so ship the raw count and let the consumer
   * compare it against whatever denominator its question needs.
   */
  peakUnitsMean: number;
  peakUnitsMax: number;
  unitHoursSold: number;
  unitHoursOffered: number;
  fillPct: number;
  slotsAtCapacity: number;
  /**
   * Days whose peak reached or exceeded what the fleet can CURRENTLY field.
   *
   * `slotsAtCapacity` above is measured against nameplate, which is the only stable denominator for
   * history — but it understates how tight things actually were. Dallas's Aug 22 peaked at 24 ATVs:
   * 88.9% of the 27 nameplate, so it misses a 90% threshold entirely, while being 109% of the 22
   * currently serviceable. The market was oversold and the nameplate figure calls it "not at capacity".
   *
   * This counter uses today's serviceable fleet, which is the right denominator for a forward-looking
   * decision: it answers "if this pattern repeats, can we serve it with what we have now?"
   */
  daysAtOrOverServiceable: number;
  bindingResourceName: string | null;
  /** Too few observed days to act on. Mirrors the coverage-floor discipline used in the cockpit. */
  thin: boolean;
};

/**
 * How much the structural half can actually be trusted for this market.
 *
 *   `none`   — fewer than 2 observed weeks. Do not read the cells at all.
 *   `thin`   — 2–7 weeks. Directionally interesting, not decision-grade.
 *   `usable` — 8+ weeks, so every weekday has ~8 observations.
 */
export type StructuralConfidence = "none" | "thin" | "usable";

export type StructuralResult = {
  basis: "nameplate";
  lookbackDays: number;
  window: { fromLocalDate: string; toLocalDate: string };
  /**
   * The date this market started taking its OWN bookings, derived from the first non-imported
   * booking so it maintains itself.
   *
   * Without this floor the fill percentages are meaningless. Dallas's schedule was materialised on
   * 2026-06-28 but its first real booking landed 2026-08-18 — so seven weeks of slots sat in the table
   * that nothing COULD book. Averaging them in reported Dallas Saturdays at 23% full when the one live
   * Saturday had run at 109% of serviceable capacity. Pre-launch slots are not weak demand; they are
   * not demand at all.
   */
  liveFromLocalDate: string | null;
  weeksObserved: number;
  confidence: StructuralConfidence;
  saturationThresholdPct: number;
  thinCellMinDays: number;
  cells: StructuralCell[];
};

type SlotRow = {
  id: string;
  startsAt: Date;
  endsAt: Date;
};

type UsageRow = {
  resource_id: string;
  availability_id: string;
  starts_at: string | Date;
  ends_at: string | Date;
  units: number | string;
};

function asDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Union length of intervals in hours — overlapping slots must not be counted twice. */
function unionHours(intervals: { start: number; end: number }[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0]!.start;
  let curEnd = sorted[0]!.end;
  for (let i = 1; i < sorted.length; i++) {
    const iv = sorted[i]!;
    if (iv.start > curEnd) {
      total += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    } else if (iv.end > curEnd) {
      curEnd = iv.end;
    }
  }
  total += curEnd - curStart;
  return total / 3_600_000;
}

/**
 * When this market started taking its own bookings.
 *
 * Derived rather than configured so it cannot drift: imported FareHarbor rows are excluded because
 * they were back-filled from the old system and say nothing about when OUR booking flow went live.
 * Returns null when a market has taken no bookings of its own yet — the caller then reports zero
 * confidence rather than inventing a window.
 */
async function liveFrom(locationId: string): Promise<Date | null> {
  const row = (
    await getDb()
      .select({ first: sql<string | null>`min(${bookings.createdAt})` })
      .from(bookings)
      .where(and(eq(bookings.locationId, locationId), isNull(bookings.externalRef)))
  )[0];
  if (!row?.first) return null;
  // `bookings.created_at` is a NAIVE timestamp holding UTC — see the repo-wide convention.
  const iso = String(row.first).replace(" ", "T");
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
}

export async function structuralUtilisation(
  locationId: string,
  tz: string,
  opts: { asOf?: Date; lookbackDays?: number } = {},
): Promise<StructuralResult> {
  const asOf = opts.asOf ?? new Date();
  const lookbackDays = opts.lookbackDays ?? LOOKBACK_DAYS;

  // Whole local days, so a cell never contains a partial day at either end.
  const endLocal = DateTime.fromJSDate(asOf, { zone: tz }).startOf("day");
  const lookbackStart = endLocal.minus({ days: lookbackDays });

  // Floor at go-live. Slots that existed before the market could take a booking are not weak demand.
  const live = await liveFrom(locationId);
  const liveLocal = live ? DateTime.fromJSDate(live, { zone: tz }).startOf("day") : null;
  const startLocal =
    liveLocal && liveLocal > lookbackStart ? liveLocal : lookbackStart;

  const from = startLocal.toUTC().toJSDate();
  const to = endLocal.toUTC().toJSDate();

  const db = getDb();
  const fleet = await fleetForLocation(locationId);
  const byResource = new Map<string, FleetPool>(fleet.map((f) => [f.resourceId, f]));

  // Query 1 — every slot OFFERED in the window. This is the denominator, and it must come from slots
  // rather than wall-clock time: a market that runs no midweek mornings has not failed to sell them.
  const slots: SlotRow[] = await db
    .select({
      id: availabilities.id,
      startsAt: availabilities.startsAt,
      endsAt: availabilities.endsAt,
    })
    .from(availabilities)
    .innerJoin(items, eq(items.id, availabilities.itemId))
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, from),
        lt(availabilities.startsAt, to),
      ),
    );

  // Query 2 — consumed units per resource per slot. Bookings only; no seat holds (see header).
  // `quantity * quantity_consumed` because a Double Rider ATV is one machine and two riders.
  const usage = (await db.execute(sql`
    SELECT rr.resource_id,
           a.id AS availability_id,
           a.starts_at,
           a.ends_at,
           SUM(bl.quantity * rr.quantity_consumed)::int AS units
      FROM bookings b
      JOIN availabilities a ON a.id = b.availability_id
      JOIN items i ON i.id = a.item_id AND i.location_id = ${locationId}::uuid
      JOIN booking_lines bl ON bl.booking_id = b.id
      JOIN resource_requirements rr
        ON rr.item_id = b.item_id AND rr.customer_type_id = bl.customer_type_id
     WHERE b.status = 'active'
       AND a.starts_at >= ${from} AND a.starts_at < ${to}
     GROUP BY rr.resource_id, a.id, a.starts_at, a.ends_at
  `)) as unknown as { rows?: UsageRow[] } | UsageRow[];

  const usageRows: UsageRow[] = Array.isArray(usage) ? usage : (usage.rows ?? []);

  // Bucket both sides by (local date, dow, daypart).
  type Bucket = {
    dow: Dow;
    daypart: Daypart;
    localDate: string;
    slotIntervals: { start: number; end: number }[];
    slotIds: Set<string>;
    usage: Map<string, { resourceId: string; startsAt: Date; endsAt: Date; units: number }[]>;
  };
  const buckets = new Map<string, Bucket>();

  const bucketFor = (startsAt: Date): Bucket => {
    const local = DateTime.fromJSDate(startsAt, { zone: tz });
    const dow = local.weekday % 7 as Dow; // Luxon: 1=Mon..7=Sun → JS 0=Sun..6=Sat
    const daypart = daypartForHour(local.hour);
    const localDate = local.toISODate()!;
    const key = `${localDate}|${cellKey(dow, daypart)}`;
    let b = buckets.get(key);
    if (!b) {
      b = { dow, daypart, localDate, slotIntervals: [], slotIds: new Set(), usage: new Map() };
      buckets.set(key, b);
    }
    return b;
  };

  for (const s of slots) {
    const b = bucketFor(s.startsAt);
    b.slotIds.add(s.id);
    b.slotIntervals.push({ start: s.startsAt.getTime(), end: s.endsAt.getTime() });
  }
  for (const u of usageRows) {
    const startsAt = asDate(u.starts_at);
    const b = bucketFor(startsAt);
    const list = b.usage.get(u.resource_id) ?? [];
    list.push({
      resourceId: u.resource_id,
      startsAt,
      endsAt: asDate(u.ends_at),
      units: Number(u.units),
    });
    b.usage.set(u.resource_id, list);
  }

  // Roll day-level buckets up into (dow × daypart) cells.
  // Per-resource accumulation, deliberately.
  //
  // An earlier version tracked one peak per cell and picked the binding pool by majority vote across
  // days. Those two can describe DIFFERENT pools: Houston reported a peak of 8 units labelled "UTV"
  // against a UTV fleet of 1, because the 8 came from a day where ATV was binding while UTV was the
  // more frequent label. A consumer comparing that peak to that pool's size gets nonsense. Keeping
  // everything per resource means the reported peak and the reported pool always match.
  type ResAcc = { name: string; nameplate: number; pcts: number[]; units: number[] };
  type Acc = {
    days: Set<string>;
    slots: number;
    perResource: Map<string, ResAcc>;
    unitHoursSold: number;
    unitHoursOffered: number;
    slotsAtCapacity: number;
    daysAtOrOverServiceable: number;
  };
  const acc = new Map<string, Acc>();

  for (const b of buckets.values()) {
    const key = cellKey(b.dow, b.daypart);
    let a = acc.get(key);
    if (!a) {
      a = {
        days: new Set(),
        slots: 0,
        perResource: new Map(),
        unitHoursSold: 0,
        unitHoursOffered: 0,
        slotsAtCapacity: 0,
        daysAtOrOverServiceable: 0,
      };
      acc.set(key, a);
    }
    a.days.add(b.localDate);
    a.slots += b.slotIds.size;

    // Clip the sweep to the daypart, so an evening tour spilling past midnight is not counted twice.
    const dayStart = DateTime.fromISO(b.localDate, { zone: tz }).startOf("day");
    const windowStart = dayStart.plus({ hours: DAYPART_HOURS[b.daypart].from }).toUTC().toJSDate();
    const windowEnd = dayStart.plus({ hours: DAYPART_HOURS[b.daypart].to }).toUTC().toJSDate();

    const openHours = unionHours(
      b.slotIntervals.map((iv) => ({
        start: Math.max(iv.start, windowStart.getTime()),
        end: Math.min(iv.end, windowEnd.getTime()),
      })).filter((iv) => iv.end > iv.start),
    );

    // Peak is per resource; the binding one is whichever ran hottest against its own nameplate.
    let dayPeakPct = 0;
    let hitServiceable = false;
    for (const [resourceId, intervals] of b.usage) {
      const pool = byResource.get(resourceId);
      if (!pool || pool.nameplateUnits <= 0) continue;
      const peak = peakConcurrent(
        intervals.map((i) => ({
          resourceId,
          startsAt: i.startsAt,
          endsAt: i.endsAt,
          units: i.units,
        })),
        windowStart,
        windowEnd,
      );
      if (pool.serviceableUnits > 0 && peak >= pool.serviceableUnits) hitServiceable = true;
      const pct = (100 * peak) / pool.nameplateUnits;
      if (pct > dayPeakPct) dayPeakPct = pct;
      let ra = a.perResource.get(resourceId);
      if (!ra) {
        ra = { name: pool.name, nameplate: pool.nameplateUnits, pcts: [], units: [] };
        a.perResource.set(resourceId, ra);
      }
      ra.pcts.push(pct);
      ra.units.push(peak);
      // Machine-hours: each booking's units for as long as it overlaps the daypart.
      for (const iv of intervals) {
        const overlapMs =
          Math.min(iv.endsAt.getTime(), windowEnd.getTime()) -
          Math.max(iv.startsAt.getTime(), windowStart.getTime());
        if (overlapMs > 0) a.unitHoursSold += (iv.units * overlapMs) / 3_600_000;
      }
      a.unitHoursOffered += pool.nameplateUnits * openHours;
    }
    // No usage at all still offered capacity — otherwise an empty day vanishes from the denominator
    // and the cell reads as fuller than it was.
    if (b.usage.size === 0 && openHours > 0) {
      const largest = fleet.reduce<FleetPool | null>(
        (m, p) => (m === null || p.nameplateUnits > m.nameplateUnits ? p : m),
        null,
      );
      if (largest) a.unitHoursOffered += largest.nameplateUnits * openHours;
    }

    if (dayPeakPct >= SATURATION_PCT) a.slotsAtCapacity += 1;
    if (hitServiceable) a.daysAtOrOverServiceable += 1;
  }

  const cells: StructuralCell[] = [];
  for (const dow of [0, 1, 2, 3, 4, 5, 6] as Dow[]) {
    for (const daypart of DAYPARTS) {
      const a = acc.get(cellKey(dow, daypart));
      if (!a || a.days.size === 0) continue; // never offered — omitted, never reported as 0% demand
      // The binding pool is the one that ran hottest against its OWN nameplate across the window, and
      // every peak figure below is that pool's — so `peak_units_max` can always be compared against
      // `binding_resource_name`'s fleet size.
      const resources = [...a.perResource.values()].filter((r) => r.pcts.length > 0);
      const bindingRes =
        resources.sort((x, y) => Math.max(...y.pcts) - Math.max(...x.pcts))[0] ?? null;
      const pcts = bindingRes?.pcts ?? [0];
      const units = bindingRes?.units ?? [0];
      const mean = pcts.reduce((sum, v) => sum + v, 0) / pcts.length;
      const binding = bindingRes?.name ?? null;
      cells.push({
        dow,
        dowName: DOW_NAMES[dow],
        daypart,
        daysObserved: a.days.size,
        slotsObserved: a.slots,
        peakFleetPctMean: Math.round(mean * 10) / 10,
        peakFleetPctMax: Math.round(Math.max(...pcts) * 10) / 10,
        peakUnitsMean: Math.round((units.reduce((x, y) => x + y, 0) / units.length) * 10) / 10,
        peakUnitsMax: Math.max(...units),
        unitHoursSold: Math.round(a.unitHoursSold * 10) / 10,
        unitHoursOffered: Math.round(a.unitHoursOffered * 10) / 10,
        fillPct:
          a.unitHoursOffered > 0
            ? Math.round((1000 * a.unitHoursSold) / a.unitHoursOffered) / 10
            : 0,
        slotsAtCapacity: a.slotsAtCapacity,
        daysAtOrOverServiceable: a.daysAtOrOverServiceable,
        bindingResourceName: binding,
        thin: a.days.size < THIN_CELL_MIN_DAYS,
      });
    }
  }

  const daysCovered = Math.max(0, endLocal.diff(startLocal, "days").days);
  const weeksObserved = Math.floor(daysCovered / 7);
  const confidence: StructuralConfidence =
    live === null || weeksObserved < 2 ? "none" : weeksObserved < 8 ? "thin" : "usable";

  return {
    basis: "nameplate",
    lookbackDays,
    window: {
      fromLocalDate: startLocal.toISODate()!,
      toLocalDate: endLocal.minus({ days: 1 }).toISODate()!,
    },
    liveFromLocalDate: liveLocal ? liveLocal.toISODate() : null,
    weeksObserved,
    confidence,
    saturationThresholdPct: SATURATION_PCT,
    thinCellMinDays: THIN_CELL_MIN_DAYS,
    cells,
  };
}
