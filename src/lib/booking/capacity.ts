// Pure capacity math. MIRRORED between turbobookings-dashboard
// (src/lib/booking/capacity.ts) and bookingsystem (src/lib/availability/capacity.ts) —
// keep the two byte-identical, the way resourceUsage.ts is. Given already-gathered
// numbers, answers how much room a slot has: the operator manifest, the storefront
// steppers and every oversell check all come through here.
//
// ## Why capacity is per CUSTOMER TYPE and not one number per slot
//
// This used to be `resourceRemaining(pools) -> number`: one scalar per slot, taken as
// the MINIMUM across every pool the tour draws on, after collapsing each pool to the
// LARGEST consumption any of the tour's customer types had for it.
//
// That is right when a tour's pools are all required TOGETHER — Dallas's Glow Tour
// takes 1 ATV *and* 1 glow kit, so it is capped by whichever runs out first. It is
// wrong when the pools are ALTERNATIVES. Miami's UTV tours sell a 2-Seat option and a
// 4-Seat option; those are different machines, 3 of one and 1 of the other. Under the
// min rule the single four-seater would cap the whole tour at 1, and the moment it
// sold, the three two-seaters would become unsellable.
//
// So the question a slot can actually answer is not "how many left" but "how many more
// of THIS option fit, given what is already in the cart". `headroomForType` answers
// that; `cartFits` is the authoritative check that a whole basket clears every pool at
// once. Both take the raw (customer_type -> resource, quantity_consumed) requirements
// instead of a per-pool collapse, so alternatives and shared pools are both exact:
//
//   * Alternatives (Miami UTV):  2-Seat -> UTVs 2-Seat, 4-Seat -> UTVs 4-Seat.
//     Selling the four-seater leaves the two-seaters untouched.
//   * Shared pool (every ATV tour): Single Rider and Double Rider BOTH take 1 ATV, so
//     each sees the whole fleet as headroom and `cartFits` stops the pair between them
//     from exceeding it. Identical to the old behaviour — this is the no-regression case.
//
// Headroom is therefore NEVER additive across customer types. Two options showing "36
// left" against one shared pool of 36 is 36 machines, not 72.

export type Pool = {
  resourceId: string;
  maxConcurrentUses: number;
  outOfServiceCount: number;
  // Units already committed during the slot's window — the PEAK concurrent figure from
  // overlappingResourceUsage, across every tour at the location, not just this one.
  consumed: number;
};

export type Requirement = {
  customerTypeId: string;
  resourceId: string;
  quantityConsumed: number;
};

/** customer_type_id -> units of that type. */
export type Cart = ReadonlyMap<string, number>;

export const EMPTY_CART: Cart = new Map();

// A stored 0 means "consumes nothing measurable", which would divide by zero and hand
// out infinite headroom. The old code applied the same `> 0 ? n : 1` guard; keep it.
const perUnit = (r: Requirement): number =>
  r.quantityConsumed > 0 ? r.quantityConsumed : 1;

// Fixed-capacity tour: base capacity minus what's booked.
export function fixedRemaining(
  baseCapacity: number | null,
  bookedUnits: number,
): number {
  if (baseCapacity == null) return 0;
  return Math.max(0, baseCapacity - bookedUnits);
}

/** Units of each pool still free on this slot. */
export function freeByPool(pools: Pool[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pools) {
    out.set(
      p.resourceId,
      Math.max(0, p.maxConcurrentUses - p.outOfServiceCount - p.consumed),
    );
  }
  return out;
}

/** What a cart draws from each pool. */
function consumptionOf(cart: Cart, reqs: Requirement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of reqs) {
    const qty = cart.get(r.customerTypeId) ?? 0;
    if (qty <= 0) continue;
    out.set(r.resourceId, (out.get(r.resourceId) ?? 0) + qty * perUnit(r));
  }
  return out;
}

/**
 * How many MORE units of `customerTypeId` fit on top of `cart`.
 *
 * Pass EMPTY_CART for the standalone "N left" a slot shows for this option; pass the
 * shopper's current basket to cap a stepper, so two options sharing a pool draw each
 * other down as the basket grows.
 *
 * A customer type with no requirement rows returns 0 rather than infinity. A tour with
 * pricing but no resource requirement is otherwise bookable and silently oversells —
 * the half-configured state scripts/add-htown-tours.ts exists to avoid.
 */
export function headroomForType(
  cart: Cart,
  customerTypeId: string,
  pools: Pool[],
  reqs: Requirement[],
): number {
  return headroomFromFree(freeByPool(pools), cart, customerTypeId, reqs);
}

/**
 * `headroomForType` against an already-computed free-units map.
 *
 * Exists so the booking widget can recompute stepper ceilings in the BROWSER as the shopper
 * changes quantities, without shipping nameplate and out-of-service counts to the page or
 * re-deriving the rule there. The server sends free units per pool; this applies the same
 * function to them, so the ceiling the shopper sees and the one the commit enforces cannot drift.
 */
export function headroomFromFree(
  free: ReadonlyMap<string, number>,
  cart: Cart,
  customerTypeId: string,
  reqs: Requirement[],
): number {
  const mine = reqs.filter((r) => r.customerTypeId === customerTypeId);
  if (mine.length === 0) return 0;
  const used = consumptionOf(cart, reqs);
  let min = Infinity;
  for (const r of mine) {
    const avail = (free.get(r.resourceId) ?? 0) - (used.get(r.resourceId) ?? 0);
    min = Math.min(min, Math.floor(avail / perUnit(r)));
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}

/**
 * THE authoritative basket check: every pool must clear at once.
 *
 * This is what a commit path calls. It is not the same as each type having headroom on its
 * own — two options sharing one pool can each look fine and still bust it together.
 */
export function cartFits(
  cart: Cart,
  pools: Pool[],
  reqs: Requirement[],
): boolean {
  const configured = new Set(reqs.map((r) => r.customerTypeId));
  for (const [customerTypeId, qty] of cart) {
    if (qty <= 0) continue;
    // Unconfigured type: no requirement row, so it would consume nothing and always
    // fit. Refuse instead — see headroomForType.
    if (!configured.has(customerTypeId)) return false;
  }
  const free = freeByPool(pools);
  for (const [resourceId, used] of consumptionOf(cart, reqs)) {
    if (used > (free.get(resourceId) ?? 0)) return false;
  }
  return true;
}

/**
 * The best any single option can do on this slot.
 *
 * This is the SOLD-OUT test: a slot is sold out only when nothing at all can be sold, so it is a
 * max over options, never a min. The min is what the old rule did, and it is exactly why Miami's
 * one out-of-service four-seater would otherwise take the three two-seaters down with it.
 *
 * Not the same as `slotRemaining`: a customer type requiring two pools at once (Dallas's Glow
 * Tour takes an ATV *and* a glow kit) can have zero headroom while both pools still show free
 * units, so summing free units would call a dead slot alive.
 */
export function bestTypeRemaining(pools: Pool[], reqs: Requirement[]): number {
  let best = 0;
  for (const customerTypeId of new Set(reqs.map((r) => r.customerTypeId))) {
    const h = headroomForType(EMPTY_CART, customerTypeId, pools, reqs);
    if (h > best) best = h;
  }
  return best;
}

/** Standalone "N left" for every option on the tour, for display and stepper ceilings. */
export function remainingByType(
  pools: Pool[],
  reqs: Requirement[],
  cart: Cart = EMPTY_CART,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const customerTypeId of new Set(reqs.map((r) => r.customerTypeId))) {
    out.set(customerTypeId, headroomForType(cart, customerTypeId, pools, reqs));
  }
  return out;
}

/**
 * Total additional units sellable on the slot, across all of the tour's options.
 *
 * OPERATOR DISPLAY ONLY — the manifest's "N left" and the inventory feed's sellable counts.
 * Never use it to decide whether a booking fits (`cartFits`) or whether a slot is dead
 * (`bestTypeRemaining`).
 *
 * Computed by greedily adding one unit of whichever option still fits until none does. That is
 * NOT the same as summing free pool units, and the difference is load-bearing:
 *
 *   * Alternatives on separate pools (Miami UTV): 3 two-seaters + 1 four-seater = 4. Summing is
 *     right here, which is why the naive version looked correct.
 *   * One option requiring two pools AT ONCE (Dallas's Glow Tour takes an ATV *and* a glow kit):
 *     22 ATVs and 10 kits is 10 sellable glow rides, not 32. Summing reported a third of the
 *     fleet as sellable inventory that does not exist.
 *   * Options sharing one pool (every ATV tour): the pool is counted once, not once per option.
 *
 * Bounded by total nameplate, so it always terminates.
 */
export function slotRemaining(pools: Pool[], reqs: Requirement[]): number {
  const types = [...new Set(reqs.map((r) => r.customerTypeId))];
  if (types.length === 0) return 0;
  const ceiling = pools.reduce((n, p) => n + Math.max(0, p.maxConcurrentUses), 0);
  const cart = new Map<string, number>();
  let total = 0;
  while (total < ceiling) {
    let picked: string | null = null;
    let best = 0;
    for (const t of types) {
      const h = headroomForType(cart, t, pools, reqs);
      if (h > best) {
        best = h;
        picked = t;
      }
    }
    if (picked == null) break;
    cart.set(picked, (cart.get(picked) ?? 0) + 1);
    total += 1;
  }
  return total;
}
