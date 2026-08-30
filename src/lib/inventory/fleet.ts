import "server-only";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  availabilities,
  customerTypes,
  getDb,
  itemCustomerTypes,
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
  /** Every option this tour sells — all of them are dead, or it would not be here. */
  blockedOptions: string[];
};

/**
 * Tours where SOME options are dead and others still sell.
 *
 * A separate signal from `BlockedItem` on purpose. "Pause the spend, it is 100% waste" is only true
 * when a tour cannot be sold at all; a tour that has lost one of its two vehicle sizes has lost
 * some inventory, not all of it, and telling the ad system otherwise would cut spend on a tour
 * that is still filling.
 */
export type PartiallyBlockedItem = {
  itemId: string;
  itemName: string;
  blockedOptions: { name: string; resourceName: string }[];
  sellableOptions: string[];
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
 * Tours that cannot be sold at all right now, and tours that have lost only some of their options.
 *
 * This is the sharpest signal in the whole feed and it needs no statistics: Miami had 4 UTVs and all
 * 4 out of service, so both UTV tours were unsellable while still listed and still able to receive
 * ad spend. Every dollar pointed at them was 100% waste. A percentage would bury that; a boolean
 * does not. `slotsAffectedNext7d` sizes the loss so it can be ranked against other recommendations.
 *
 * ## Why this is per OPTION and not per pool
 *
 * This used to flag a tour when ANY pool it touched had zero serviceable units. That was right when
 * a tour's pools were all required together. It is wrong once a tour sells ALTERNATIVES: Miami's
 * 1-Hour UTV Tour draws on a 2-Seat pool and a 4-Seat pool, and pulling the single four-seater for
 * maintenance would have reported the whole tour as unsellable while it still had three two-seaters
 * to sell. That payload drives "pause the spend" recommendations, so the false positive costs real
 * bookings.
 *
 * A tour is blocked only when EVERY option it sells is dead. Losing some of them is reported
 * separately, as `partiallyBlocked`.
 */
export async function blockedInventory(
  locationId: string,
  fleet: FleetPool[],
  now: Date,
): Promise<{ blocked: BlockedItem[]; partiallyBlocked: PartiallyBlockedItem[] }> {
  const dead = new Map(
    fleet.filter((p) => p.serviceableUnits === 0).map((p) => [p.resourceId, p]),
  );
  if (dead.size === 0) return { blocked: [], partiallyBlocked: [] };

  const db = getDb();
  // Every option each tour actually offers, with the pools it needs. Hidden and archived types are
  // excluded: an operator-only comp type going unsellable is not an ad-spend signal.
  const rows = await db
    .select({
      itemId: items.id,
      itemName: items.name,
      bookableOnline: items.bookableOnline,
      customerTypeId: itemCustomerTypes.customerTypeId,
      optionName: customerTypes.singular,
      resourceId: resourceRequirements.resourceId,
    })
    .from(itemCustomerTypes)
    .innerJoin(items, eq(items.id, itemCustomerTypes.itemId))
    .innerJoin(customerTypes, eq(customerTypes.id, itemCustomerTypes.customerTypeId))
    .leftJoin(
      resourceRequirements,
      and(
        eq(resourceRequirements.itemId, itemCustomerTypes.itemId),
        eq(resourceRequirements.customerTypeId, itemCustomerTypes.customerTypeId),
      ),
    )
    .where(
      and(
        eq(items.locationId, locationId),
        eq(items.capacityMode, "resource_based"),
        eq(itemCustomerTypes.visibility, "visible"),
        eq(customerTypes.archived, false),
      ),
    );
  if (rows.length === 0) return { blocked: [], partiallyBlocked: [] };

  type Opt = { name: string; resourceIds: string[] };
  type Acc = {
    itemName: string;
    bookableOnline: boolean;
    options: Map<string, Opt>;
  };
  const byItem = new Map<string, Acc>();
  for (const r of rows) {
    let acc = byItem.get(r.itemId);
    if (!acc) {
      acc = { itemName: r.itemName, bookableOnline: r.bookableOnline, options: new Map() };
      byItem.set(r.itemId, acc);
    }
    let opt = acc.options.get(r.customerTypeId);
    if (!opt) {
      opt = { name: r.optionName, resourceIds: [] };
      acc.options.set(r.customerTypeId, opt);
    }
    if (r.resourceId) opt.resourceIds.push(r.resourceId);
  }

  const blocked: BlockedItem[] = [];
  const partiallyBlocked: PartiallyBlockedItem[] = [];
  const affectedItemIds: string[] = [];

  for (const [itemId, acc] of byItem) {
    const deadOptions: { name: string; resourceName: string }[] = [];
    const liveOptions: string[] = [];
    for (const opt of acc.options.values()) {
      // An option needs EVERY pool it requires, so one dead pool kills it. An option with no
      // requirement row at all cannot be sold either — the capacity math fails closed on it.
      const killer = opt.resourceIds.find((id) => dead.has(id));
      if (killer) deadOptions.push({ name: opt.name, resourceName: dead.get(killer)!.name });
      else if (opt.resourceIds.length > 0) liveOptions.push(opt.name);
    }
    if (deadOptions.length === 0) continue;
    affectedItemIds.push(itemId);
    if (liveOptions.length === 0) {
      blocked.push({
        itemId,
        itemName: acc.itemName,
        reason: "resource_out_of_service",
        resourceName: deadOptions[0].resourceName,
        serviceableUnits: 0,
        slotsAffectedNext7d: 0,
        bookableOnline: acc.bookableOnline,
        blockedOptions: deadOptions.map((o) => o.name),
      });
    } else {
      partiallyBlocked.push({
        itemId,
        itemName: acc.itemName,
        blockedOptions: deadOptions,
        sellableOptions: liveOptions,
        slotsAffectedNext7d: 0,
        bookableOnline: acc.bookableOnline,
      });
    }
  }
  if (affectedItemIds.length === 0) return { blocked: [], partiallyBlocked: [] };

  const until = new Date(now.getTime() + 7 * 86_400_000);
  const slotCounts = await db
    .select({ itemId: availabilities.itemId, id: availabilities.id })
    .from(availabilities)
    .where(
      and(
        inArray(availabilities.itemId, affectedItemIds),
        gte(availabilities.startsAt, now),
        lt(availabilities.startsAt, until),
      ),
    );
  const affected = new Map<string, number>();
  for (const s of slotCounts) affected.set(s.itemId, (affected.get(s.itemId) ?? 0) + 1);
  for (const b of blocked) b.slotsAffectedNext7d = affected.get(b.itemId) ?? 0;
  for (const p of partiallyBlocked) p.slotsAffectedNext7d = affected.get(p.itemId) ?? 0;

  return { blocked, partiallyBlocked };
}
