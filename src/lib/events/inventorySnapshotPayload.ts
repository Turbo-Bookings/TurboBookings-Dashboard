import "server-only";
import { blockedItems, fleetForLocation } from "@/lib/inventory/fleet";
import { horizonDaysFor, leadTimeAndMatrix } from "@/lib/inventory/leadTime";
import { nearTermInventory } from "@/lib/inventory/nearTerm";
import { structuralUtilisation } from "@/lib/inventory/structural";
import type { Location } from "@/lib/db/schema";

// The `data` block of an `inventory.snapshot` event.
//
// ## What must match on the receiving side
//
// The cockpit stores this whole payload and reads a downsampled summary of it into the fact pack.
// Field names here are the contract; renaming one silently breaks a signal rather than erroring.
// Keep this file and `cockpit/inventory.py` in step, the same way `bookingCreatedPayload.ts` and
// `cockpit/turbobookings.py` are.
//
// ## A snapshot SUPERSEDES — it is not an append-only fact
//
// Unlike `booking.created`, two consecutive snapshots are not two facts to accumulate; the later one
// replaces the earlier. `snapshot_scope` names the replacement key and `captured_at` orders them. The
// receiver must reject an out-of-order write, because the retry queue can otherwise deliver a stale
// snapshot hours late and overwrite a fresh one.

export type InventorySnapshotData = Record<string, unknown>;

export async function buildInventorySnapshotPayload(
  location: Location,
  now: Date,
): Promise<InventorySnapshotData> {
  const tz = location.timezone;
  if (!tz) {
    // Never default to UTC. A five-hour shift moves Saturday evening into Sunday and mislabels the
    // exact cell the cockpit would steer on. Skipping loudly is the correct failure.
    throw new Error(`location ${location.slug} has no timezone; refusing to guess`);
  }

  const fleet = await fleetForLocation(location.id);
  const lead = await leadTimeAndMatrix(location.id, tz);
  const horizonDays = horizonDaysFor(lead.leadTime);

  const [blocked, nearTerm, structural] = await Promise.all([
    blockedItems(location.id, fleet, now),
    nearTermInventory(location.id, tz, now, horizonDays),
    structuralUtilisation(location.id, tz, { asOf: now }),
  ]);

  return {
    snapshot_scope: `inventory:${location.id}`,
    captured_at: now.toISOString(),
    generator_version: 1,
    timezone: tz,
    local_date: nearTerm.asOfLocal.slice(0, 10),

    // "Units" are bookable rider units for the tightest customer type on a tour — not machines and
    // not people. A Double Rider ATV is one machine and two riders. Stated because this WILL be
    // argued about otherwise.
    units_meaning:
      "bookable rider units for the tightest customer type on the tour (not machines, not people)",

    fleet: fleet.map((f) => ({
      resource_id: f.resourceId,
      name: f.name,
      nameplate_units: f.nameplateUnits,
      out_of_service_units: f.outOfServiceUnits,
      serviceable_units: f.serviceableUnits,
    })),

    // Tours that cannot be sold AT ALL right now. The sharpest item in the payload and the only one
    // needing no statistics: Miami has 4 UTVs, all 4 out of service, and both UTV tours remain listed
    // and able to receive spend. Every dollar aimed at them today is waste.
    blocked_items: blocked.map((b) => ({
      item_id: b.itemId,
      item_name: b.itemName,
      reason: b.reason,
      resource_name: b.resourceName,
      serviceable_units: b.serviceableUnits,
      slots_affected_next_7d: b.slotsAffectedNext7d,
      bookable_online: b.bookableOnline,
    })),

    lead_time: {
      lookback_days: lead.lookbackDays,
      bookings: lead.leadTime.bookings,
      median_days: lead.leadTime.medianDays,
      p95_days: lead.leadTime.p95Days,
      within_1d_pct: lead.leadTime.within1dPct,
      within_3d_pct: lead.leadTime.within3dPct,
      within_7d_pct: lead.leadTime.within7dPct,
      // ⚠️ Rows = day the booking was MADE, columns = day the tour RUNS. Two different dimensions.
      // Google's set_ad_schedule bids on the FORMER; capacity is about the LATTER. Never infer a
      // serving-day bid change from a tour-day shortage without going through this matrix.
      booking_day_to_tour_day: lead.bookingDayMatrix.map((c) => ({
        booked_dow: c.bookedDow,
        booked_dow_name: c.bookedDowName,
        tour_dow: c.tourDow,
        tour_dow_name: c.tourDowName,
        bookings: c.bookings,
        share_of_all_pct: c.shareOfAllPct,
      })),
    },

    structural: {
      basis: structural.basis,
      basis_note:
        "Denominator is nameplate (max_concurrent_uses). out_of_service_count is a CURRENT scalar " +
        "with no history — netting it out would retroactively rewrite past utilisation every time a " +
        "machine goes down. days_at_or_over_serviceable answers the forward-looking question instead.",
      live_from_local_date: structural.liveFromLocalDate,
      weeks_observed: structural.weeksObserved,
      // none | thin | usable. All three markets went live 2026-08-18..21, so this reads `none`
      // until roughly November. That is honest, not broken — do not read the cells while it does.
      confidence: structural.confidence,
      lookback_days: structural.lookbackDays,
      window: {
        from_local_date: structural.window.fromLocalDate,
        to_local_date: structural.window.toLocalDate,
      },
      saturation_threshold_pct: structural.saturationThresholdPct,
      thin_cell_min_days: structural.thinCellMinDays,
      cells: structural.cells.map((c) => ({
        dow: c.dow,
        dow_name: c.dowName,
        daypart: c.daypart,
        days_observed: c.daysObserved,
        slots_observed: c.slotsObserved,
        peak_units_mean: c.peakUnitsMean,
        peak_units_max: c.peakUnitsMax,
        peak_fleet_pct_mean: c.peakFleetPctMean,
        peak_fleet_pct_max: c.peakFleetPctMax,
        unit_hours_sold: c.unitHoursSold,
        unit_hours_offered: c.unitHoursOffered,
        fill_pct: c.fillPct,
        slots_at_capacity: c.slotsAtCapacity,
        days_at_or_over_serviceable: c.daysAtOrOverServiceable,
        binding_resource_name: c.bindingResourceName,
        thin: c.thin,
      })),
    },

    near_term: {
      basis: nearTerm.basis,
      basis_note:
        "Denominator nets out out_of_service_count — those machines genuinely cannot be sold today.",
      horizon_days: nearTerm.horizonDays,
      horizon_note:
        "Derived from this market's own p95 booking lead time, not a fixed constant.",
      as_of_local: nearTerm.asOfLocal,
      days: nearTerm.days.map((d) => ({
        local_date: d.localDate,
        dow: d.dow,
        offset_days: d.offsetDays,
        slots_total: d.slotsTotal,
        slots_departed: d.slotsDeparted,
        slots_remaining: d.slotsRemaining,
        slots_sold_out: d.slotsSoldOut,
        slots_sellable: d.slotsSellable,
        units_booked: d.unitsBooked,
        max_sellable_units_single_slot: d.maxSellableUnitsSingleSlot,
        sellable_units_upper_bound: d.sellableUnitsUpperBound,
        sellable_units_upper_bound_note:
          "Sum over remaining slots. Slots SHARE one resource pool, so this is an UPPER BOUND, never " +
          "additive capacity. The committable figure is max_sellable_units_single_slot.",
        first_sellable_slot_local: d.firstSellableSlotLocal,
        // Booking windows are under two days everywhere. A future date being empty is the base case,
        // not weak demand — the only actionable near-term reading is the positive one.
        low_fill_is_not_a_demand_signal: d.lowFillIsNotADemandSignal,
        dayparts: d.dayparts.map((p) => ({
          daypart: p.daypart,
          slots_remaining: p.slotsRemaining,
          slots_sold_out: p.slotsSoldOut,
          units_booked: p.unitsBooked,
          max_sellable_units_single_slot: p.maxSellableUnitsSingleSlot,
        })),
      })),
    },
  };
}
