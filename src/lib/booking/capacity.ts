// Pure capacity math (mirrors the booking app). Given gathered numbers, returns
// remaining bookable units for a slot. Used by the operator manifest (display)
// and the manual-booking + reschedule commits (oversell check).

export type ResourcePool = {
  maxConcurrentUses: number;
  outOfServiceCount: number;
  maxQuantityConsumed: number; // tightest consumer among the tour's customer types
  consumed: number; // units already consumed by active bookings on the slot
};

export function fixedRemaining(
  baseCapacity: number | null,
  bookedUnits: number,
): number {
  if (baseCapacity == null) return 0;
  return Math.max(0, baseCapacity - bookedUnits);
}

export function resourceRemaining(pools: ResourcePool[]): number {
  if (pools.length === 0) return 0;
  let min = Infinity;
  for (const p of pools) {
    const available = Math.max(
      0,
      p.maxConcurrentUses - p.outOfServiceCount - p.consumed,
    );
    const perType = p.maxQuantityConsumed > 0 ? p.maxQuantityConsumed : 1;
    min = Math.min(min, Math.floor(available / perType));
  }
  return Number.isFinite(min) ? min : 0;
}
