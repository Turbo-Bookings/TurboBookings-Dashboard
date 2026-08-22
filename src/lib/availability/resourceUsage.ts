import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";

// Structural, not the concrete NeonHttpDatabase: the booking commit passes its open PgTransaction so
// the oversell check runs inside the same transaction as the insert, and those two types are not
// assignable to each other. All this needs is `.execute()`.
type Executor = { execute: (query: SQL) => Promise<unknown> };

/**
 * How much of each shared resource is committed during a slot's window — across EVERY tour that
 * draws on the same pool, not just this one.
 *
 * ## The bug this fixes
 *
 * Capacity was computed from bookings on the slot's own `availability_id`. Two tours running on the
 * same machines each measured themselves against the whole pool, and a longer tour never noticed the
 * shorter ones running inside its window. Miami on 2026-08-22 advertised **35 ATVs free on the
 * 18:00–20:00 2-Hour tour when the true figure was 7** — 28 were already out on the 19:00 1-Hour.
 *
 * `resources.max_concurrent_uses` has always been documented as "Max concurrent uses across all
 * overlapping slots". The schema was right; only the query was wrong.
 *
 * ## Why this is a peak, not a sum
 *
 * The obvious fix — sum every booking overlapping the window — is wrong in the other direction. In
 * that same 18:00–20:00 window the 18:00 1-Hour has 9 ATVs out and the 19:00 1-Hour has 28. Summing
 * gives 37 against a pool of 35 and reports the slot oversold, but those tours never run at the same
 * time: the 9 machines come back at 19:00 and are part of the 28 that go out again.
 *
 * A machine is unavailable to a new booking only if it is out at some INSTANT the new booking needs
 * it. So the constraint is the peak concurrent usage across the window — max(9, 28) = 28, leaving 7.
 * Summing would have swung us from overbooking straight into refusing real bookings.
 *
 * Overlap is half-open (`start < windowEnd && end > windowStart`), so a tour ending at 20:00 does not
 * consume one starting at 20:00. Back-to-back slots are the normal case and must not block each other.
 */
export type ResourceUsage = Map<string, Map<string, number>>; // slotId -> resourceId -> peak units

type Interval = { resourceId: string; startsAt: Date; endsAt: Date; units: number };
type Slot = { id: string; startsAt: Date; endsAt: Date };

type IntervalRow = {
  resource_id: string;
  starts_at: string | Date;
  ends_at: string | Date;
  units: number | string;
};

/**
 * Peak simultaneous usage of intervals clipped to [windowStart, windowEnd).
 *
 * Classic boundary sweep: +units when an interval starts, -units when it ends, walk in time order
 * and keep the running maximum. Ends are processed before starts at the same timestamp, which is
 * what makes a tour ending at 20:00 free its machines for one starting at 20:00.
 */
export function peakConcurrent(
  intervals: Interval[],
  windowStart: Date,
  windowEnd: Date,
): number {
  const events: { t: number; delta: number }[] = [];
  for (const iv of intervals) {
    const s = Math.max(iv.startsAt.getTime(), windowStart.getTime());
    const e = Math.min(iv.endsAt.getTime(), windowEnd.getTime());
    if (e <= s) continue; // no real overlap with the window
    events.push({ t: s, delta: iv.units });
    events.push({ t: e, delta: -iv.units });
  }
  if (events.length === 0) return 0;
  // Ends (-) sort before starts (+) at an identical timestamp.
  events.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let running = 0;
  let peak = 0;
  for (const ev of events) {
    running += ev.delta;
    if (running > peak) peak = running;
  }
  return peak;
}

export async function overlappingResourceUsage(
  slots: Slot[],
  locationId: string,
  opts: { db?: Executor; excludeHoldToken?: string | null } = {},
): Promise<ResourceUsage> {
  const out: ResourceUsage = new Map();
  if (slots.length === 0) return out;
  const db = opts.db ?? getDb();

  // Widest window any slot could care about — one round trip for the whole page, rather than a
  // correlated query per slot.
  const from = new Date(Math.min(...slots.map((s) => s.startsAt.getTime())));
  const to = new Date(Math.max(...slots.map((s) => s.endsAt.getTime())));

  const raw = (await db.execute(sql`
    -- Confirmed bookings, joined per LINE so a rider type consuming two units counts as two.
    SELECT rr.resource_id,
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
      AND a.starts_at < ${to} AND a.ends_at > ${from}
    GROUP BY rr.resource_id, a.starts_at, a.ends_at

    UNION ALL

    -- Checkout holds. seat_holds carries no customer type, so charge each held unit the LARGEST
    -- consumption any rider type on that tour could use. Briefly over-reserving is the safe
    -- direction; the alternative is selling the same machine twice.
    SELECT m.resource_id,
           a.starts_at,
           a.ends_at,
           SUM(h.quantity * m.max_consumed)::int AS units
    FROM seat_holds h
    JOIN availabilities a ON a.id = h.availability_id
    JOIN items i ON i.id = a.item_id AND i.location_id = ${locationId}::uuid
    JOIN (
      SELECT item_id, resource_id, MAX(quantity_consumed) AS max_consumed
      FROM resource_requirements GROUP BY item_id, resource_id
    ) m ON m.item_id = a.item_id
    WHERE h.expires_at > now()
      ${opts.excludeHoldToken ? sql`AND h.hold_token <> ${opts.excludeHoldToken}::uuid` : sql``}
      AND a.starts_at < ${to} AND a.ends_at > ${from}
    GROUP BY m.resource_id, a.starts_at, a.ends_at
  `)) as unknown as { rows?: IntervalRow[] } | IntervalRow[];

  const rows: IntervalRow[] = Array.isArray(raw) ? raw : (raw.rows ?? []);
  const byResource = new Map<string, Interval[]>();
  for (const r of rows) {
    const iv: Interval = {
      resourceId: r.resource_id,
      startsAt: new Date(r.starts_at),
      endsAt: new Date(r.ends_at),
      units: Number(r.units) || 0,
    };
    const list = byResource.get(iv.resourceId);
    if (list) list.push(iv);
    else byResource.set(iv.resourceId, [iv]);
  }

  for (const slot of slots) {
    const perResource = new Map<string, number>();
    for (const [resourceId, intervals] of byResource) {
      const peak = peakConcurrent(intervals, slot.startsAt, slot.endsAt);
      if (peak > 0) perResource.set(resourceId, peak);
    }
    out.set(slot.id, perResource);
  }
  return out;
}

/** Single-slot convenience for the hold-reservation and booking-commit paths. */
export async function overlappingUsageForSlot(
  slot: Slot,
  locationId: string,
  opts: { db?: Executor; excludeHoldToken?: string | null } = {},
): Promise<Map<string, number>> {
  return (
    (await overlappingResourceUsage([slot], locationId, opts)).get(slot.id) ??
    new Map()
  );
}
