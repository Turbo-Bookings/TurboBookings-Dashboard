import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import type { Pool, Requirement } from "@/lib/booking/capacity";

// One place that loads the (tour -> pools, requirements) shape the capacity math needs.
//
// This used to be inlined at eleven call sites across the two repos, each rebuilding the
// same join and each collapsing it to one row per resource with MAX(quantity_consumed).
// That collapse is what made two ALTERNATIVE pools look like an AND-constraint, so it
// could not survive splitting Miami's UTVs into a 2-Seat and a 4-Seat fleet. Loading the
// raw requirements once, here, is what lets `headroomForType` answer per option.

// Structural, not the concrete NeonHttpDatabase: the commit paths pass their open
// PgTransaction so the oversell check runs in the same transaction as the insert, and
// those two types are not assignable to each other. All this needs is `.execute()` —
// the same trick resourceUsage.ts uses.
type Executor = { execute: (query: SQL) => Promise<unknown> };

/** Pools as stored. `consumed` is per SLOT, so it is filled in later by `withUsage`. */
export type PoolShape = Omit<Pool, "consumed">;

export type ItemCapacityInputs = {
  pools: PoolShape[];
  requirements: Requirement[];
};

const EMPTY: ItemCapacityInputs = { pools: [], requirements: [] };

type Row = {
  item_id: string;
  customer_type_id: string;
  resource_id: string;
  quantity_consumed: number | string;
  max_concurrent_uses: number | string;
  out_of_service_count: number | string;
};

function group(rows: Row[]): Map<string, ItemCapacityInputs> {
  const out = new Map<string, ItemCapacityInputs>();
  for (const r of rows) {
    let entry = out.get(r.item_id);
    if (!entry) {
      entry = { pools: [], requirements: [] };
      out.set(r.item_id, entry);
    }
    entry.requirements.push({
      customerTypeId: r.customer_type_id,
      resourceId: r.resource_id,
      quantityConsumed: Number(r.quantity_consumed) || 0,
    });
    // One pool row per resource. Several customer types can point at the same pool
    // (Single and Double Rider both take an ATV); the pool itself is listed once.
    if (!entry.pools.some((p) => p.resourceId === r.resource_id)) {
      entry.pools.push({
        resourceId: r.resource_id,
        maxConcurrentUses: Number(r.max_concurrent_uses) || 0,
        outOfServiceCount: Number(r.out_of_service_count) || 0,
      });
    }
  }
  return out;
}

async function load(
  db: Executor,
  itemIds: string[],
): Promise<Map<string, ItemCapacityInputs>> {
  // `IN ()` is a syntax error, and an array parameter cannot be cast to uuid[] over neon-http —
  // hence the expanded list below rather than `= ANY($1::uuid[])`.
  if (itemIds.length === 0) return new Map();
  const raw = (await db.execute(sql`
    SELECT rr.item_id,
           rr.customer_type_id,
           r.id AS resource_id,
           rr.quantity_consumed,
           r.max_concurrent_uses,
           r.out_of_service_count
    FROM resource_requirements rr
    JOIN resources r ON r.id = rr.resource_id
    WHERE rr.item_id IN (${sql.join(
      itemIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `)) as unknown as { rows?: Row[] } | Row[];
  return group(Array.isArray(raw) ? raw : (raw.rows ?? []));
}

/**
 * Pools + raw requirements for each item. Items with no requirements are simply absent
 * from the map — a tour with pricing but no resource requirement must sell nothing, and
 * both `headroomForType` and `cartFits` return exactly that for an empty requirement list.
 */
export async function poolsAndRequirementsForItems(
  itemIds: string[],
  opts: { db?: Executor } = {},
): Promise<Map<string, ItemCapacityInputs>> {
  if (itemIds.length === 0) return new Map();
  return load(opts.db ?? getDb(), itemIds);
}

/** Single-item convenience for the hold, commit and manual-booking paths. */
export async function poolsAndRequirementsForItem(
  itemId: string,
  opts: { db?: Executor } = {},
): Promise<ItemCapacityInputs> {
  const byItem = await load(opts.db ?? getDb(), [itemId]);
  return byItem.get(itemId) ?? EMPTY;
}

/**
 * Attach a slot's peak concurrent usage to the pools.
 *
 * `usage` is one slot's entry from `overlappingResourceUsage` — resourceId -> units
 * already out across EVERY tour overlapping the slot's window, not just this tour's.
 */
export function withUsage(
  pools: PoolShape[],
  usage: Map<string, number> | undefined,
): Pool[] {
  return pools.map((p) => ({ ...p, consumed: usage?.get(p.resourceId) ?? 0 }));
}
