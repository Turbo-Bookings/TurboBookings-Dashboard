import "server-only";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  availabilities,
  getDb,
  items,
  resourceRequirements,
  resources,
} from "@/lib/db";

// The physical fleet, and which tours a dead pool takes down with it.
//
// ## Nameplate vs serviceable — the distinction the rest of the feed depends on
//
// `resources.out_of_service_count` is a CURRENT scalar. There is no history of it, so it cannot be
// applied to the past without lying about the past: the day Dallas pulls 5 ATVs for maintenance, every
// Saturday back to June would silently re-rate from 72% to 88% full, and the cockpit would read a
// maintenance event as a demand surge.
//
//   * `nameplateUnits`   = `max_concurrent_uses`                      → the STRUCTURAL denominator
//   * `serviceableUnits` = `max_concurrent_uses − out_of_service_count` → the NEAR-TERM denominator
//
// Both ship in the payload so the gap is inspectable rather than mysterious.

export type FleetPool = {
  resourceId: string;
  name: string;
  nameplateUnits: number;
  outOfServiceUnits: number;
  serviceableUnits: number;
};

export type BlockedItem = {
  itemId: string;
  itemName: string;
  reason: "resource_out_of_service";
  resourceName: string;
  serviceableUnits: number;
  slotsAffectedNext7d: number;
  bookableOnline: boolean;
};

export async function fleetForLocation(locationId: string): Promise<FleetPool[]> {
  const rows = await getDb()
    .select({
      resourceId: resources.id,
      name: resources.name,
      nameplate: resources.maxConcurrentUses,
      oos: resources.outOfServiceCount,
    })
    .from(resources)
    .where(eq(resources.locationId, locationId));

  return rows.map((r) => ({
    resourceId: r.resourceId,
    name: r.name,
    nameplateUnits: r.nameplate,
    outOfServiceUnits: r.oos,
    serviceableUnits: Math.max(0, r.nameplate - r.oos),
  }));
}

/**
 * Tours that cannot be sold at all right now, because a pool they depend on has zero serviceable units.
 *
 * This is the sharpest signal in the whole feed and it needs no statistics: Miami has 4 UTVs and all 4
 * are out of service, so both UTV tours are unsellable while still listed and still able to receive ad
 * spend. Every dollar pointed at them today is 100% waste. A percentage would bury that; a boolean
 * does not.
 *
 * `slotsAffectedNext7d` sizes the loss so it can be ranked against other recommendations rather than
 * just flagged.
 */
export async function blockedItems(
  locationId: string,
  fleet: FleetPool[],
  now: Date,
): Promise<BlockedItem[]> {
  const dead = new Map(
    fleet.filter((p) => p.serviceableUnits === 0).map((p) => [p.resourceId, p]),
  );
  if (dead.size === 0) return [];

  const db = getDb();
  const reqs = await db
    .select({
      itemId: resourceRequirements.itemId,
      resourceId: resourceRequirements.resourceId,
      itemName: items.name,
      bookableOnline: items.bookableOnline,
    })
    .from(resourceRequirements)
    .innerJoin(items, eq(items.id, resourceRequirements.itemId))
    .where(
      and(
        eq(items.locationId, locationId),
        inArray(resourceRequirements.resourceId, [...dead.keys()]),
      ),
    );
  if (reqs.length === 0) return [];

  // One item can require several dead pools; report it once, against the first.
  const byItem = new Map<string, (typeof reqs)[number]>();
  for (const r of reqs) if (!byItem.has(r.itemId)) byItem.set(r.itemId, r);

  const until = new Date(now.getTime() + 7 * 86_400_000);
  const slotCounts = await db
    .select({ itemId: availabilities.itemId, id: availabilities.id })
    .from(availabilities)
    .where(
      and(
        inArray(availabilities.itemId, [...byItem.keys()]),
        gte(availabilities.startsAt, now),
        lt(availabilities.startsAt, until),
      ),
    );
  const affected = new Map<string, number>();
  for (const s of slotCounts) affected.set(s.itemId, (affected.get(s.itemId) ?? 0) + 1);

  return [...byItem.values()].map((r) => ({
    itemId: r.itemId,
    itemName: r.itemName,
    reason: "resource_out_of_service" as const,
    resourceName: dead.get(r.resourceId)!.name,
    serviceableUnits: 0,
    slotsAffectedNext7d: affected.get(r.itemId) ?? 0,
    bookableOnline: r.bookableOnline,
  }));
}
