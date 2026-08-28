/**
 * Inspect the inventory snapshot inputs for one or more locations.
 *
 *   npx tsx scripts/check-inventory-snapshot.ts dtown htown miami
 *
 * Exists because the numbers here are easy to get confidently wrong. Two separate mistakes were caught
 * only by eyeballing this output against what the operator knows:
 *
 *   1. An inner join on bookings averaged only the slots that HAD bookings, reporting Dallas Saturdays
 *      at 72% full.
 *   2. Dallas's schedule was materialised on 2026-06-28 but its first real booking landed 2026-08-18,
 *      so seven weeks of unbookable slots dragged the same figure down to 23%. The truth is ~70% fill
 *      with peaks at or over the serviceable fleet.
 *
 * Run this against production before trusting any change to the aggregation.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// `server-only` throws outside a React Server Component. This script IS server-side — it just isn't
// Next — so neutralise the guard before anything imports it.
const req = createRequire(import.meta.url);
try {
  const p = req.resolve("server-only");
  req.cache[p] = { id: p, filename: p, loaded: true, exports: {}, paths: [] } as never;
} catch {}

for (const f of [".env.production.local", ".env.local"]) {
  try {
    const raw = readFileSync(f, "utf8");
    for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
      const m = raw.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
      if (m?.[1] && !process.env[key]) process.env[key] = m[1];
    }
  } catch {}
}

async function main() {
  const { structuralUtilisation } = await import("@/lib/inventory/structural");
  const { nearTermInventory } = await import("@/lib/inventory/nearTerm");
  const { leadTimeAndMatrix, horizonDaysFor } = await import("@/lib/inventory/leadTime");
  const { fleetForLocation, blockedItems } = await import("@/lib/inventory/fleet");
  const { getDb, locations } = await import("@/lib/db");
  const { eq } = await import("drizzle-orm");

  for (const slug of process.argv.slice(2)) {
    const loc = (await getDb().select().from(locations).where(eq(locations.slug, slug)).limit(1))[0];
    if (!loc) { console.log(`no location ${slug}`); continue; }
    const tz = loc.timezone ?? "America/Chicago";
    const fleet = await fleetForLocation(loc.id);
    console.log(`\n=== ${slug.toUpperCase()} (${tz})`);
    console.log("fleet:", fleet.map(f => `${f.name} ${f.serviceableUnits}/${f.nameplateUnits}`).join("  "));
    const blocked = await blockedItems(loc.id, fleet, new Date());
    console.log("blocked:", blocked.length ? blocked.map(b => `${b.itemName} [${b.resourceName}] ${b.slotsAffectedNext7d} slots/7d`).join("; ") : "none");
    const lt = await leadTimeAndMatrix(loc.id, tz);
    const horizon = horizonDaysFor(lt.leadTime);
    console.log(`lead time: median ${lt.leadTime.medianDays}d, p95 ${lt.leadTime.p95Days}d, ${lt.leadTime.within3dPct}% within 3d (n=${lt.leadTime.bookings}) -> horizon ${horizon}d`);
    console.log("top booking-day -> tour-day flows:",
      lt.bookingDayMatrix.slice(0,4).map(c => `${c.bookedDowName.slice(0,3)}->${c.tourDowName.slice(0,3)} ${c.shareOfAllPct}%`).join("  "));
    const nt = await nearTermInventory(loc.id, tz, new Date(), horizon);
    console.table(nt.days.map(d => ({
      date: d.localDate, dow: d.dow, "+d": d.offsetDays, slots: d.slotsTotal,
      gone: d.slotsDeparted, left: d.slotsRemaining, soldout: d.slotsSoldOut,
      booked_u: d.unitsBooked, max_single: d.maxSellableUnitsSingleSlot,
      upper_bound: d.sellableUnitsUpperBound, empty_ok: d.lowFillIsNotADemandSignal,
    })));

    const s = await structuralUtilisation(loc.id, tz);
    console.log(`live from ${s.liveFromLocalDate ?? "(never)"} | window ${s.window.fromLocalDate} → ${s.window.toLocalDate} | ${s.weeksObserved}w observed | confidence=${s.confidence.toUpperCase()}`);
    const top = [...s.cells].sort((a,b)=>b.peakUnitsMax-a.peakUnitsMax).slice(0,6);
    console.table(top.map(c => ({
      day: c.dowName.slice(0,3), part: c.daypart, days: c.daysObserved, slots: c.slotsObserved,
      peak_u_mean: c.peakUnitsMean, peak_u_max: c.peakUnitsMax,
      peak_mean_pct: c.peakFleetPctMean, peak_max_pct: c.peakFleetPctMax, fill: c.fillPct,
      at_cap: c.slotsAtCapacity, over_svc: c.daysAtOrOverServiceable, binding: c.bindingResourceName, thin: c.thin || "",
    })));
  }
}
main().catch(e => { console.error(e); process.exit(1); });
