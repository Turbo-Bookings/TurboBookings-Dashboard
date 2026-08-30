// Run: node src/lib/booking/capacity.test.mjs
// Pure-function proof of the per-customer-type capacity rule. Mirrors capacity.ts —
// keep in sync. (Same file exists in bookingsystem at
// src/lib/availability/capacity.test.mjs; the module under test is byte-identical.)

const perUnit = (r) => (r.quantityConsumed > 0 ? r.quantityConsumed : 1);

function freeByPool(pools) {
  const out = new Map();
  for (const p of pools)
    out.set(p.resourceId, Math.max(0, p.maxConcurrentUses - p.outOfServiceCount - p.consumed));
  return out;
}
function consumptionOf(cart, reqs) {
  const out = new Map();
  for (const r of reqs) {
    const qty = cart.get(r.customerTypeId) ?? 0;
    if (qty <= 0) continue;
    out.set(r.resourceId, (out.get(r.resourceId) ?? 0) + qty * perUnit(r));
  }
  return out;
}
function headroomForType(cart, customerTypeId, pools, reqs) {
  const mine = reqs.filter((r) => r.customerTypeId === customerTypeId);
  if (mine.length === 0) return 0;
  const free = freeByPool(pools);
  const used = consumptionOf(cart, reqs);
  let min = Infinity;
  for (const r of mine) {
    const avail = (free.get(r.resourceId) ?? 0) - (used.get(r.resourceId) ?? 0);
    min = Math.min(min, Math.floor(avail / perUnit(r)));
  }
  return Number.isFinite(min) ? Math.max(0, min) : 0;
}
function cartFits(cart, pools, reqs) {
  const configured = new Set(reqs.map((r) => r.customerTypeId));
  for (const [ct, qty] of cart) {
    if (qty <= 0) continue;
    if (!configured.has(ct)) return false;
  }
  const free = freeByPool(pools);
  for (const [rid, used] of consumptionOf(cart, reqs))
    if (used > (free.get(rid) ?? 0)) return false;
  return true;
}
function bestTypeRemaining(pools, reqs) {
  let best = 0;
  for (const ct of new Set(reqs.map((r) => r.customerTypeId))) {
    const h = headroomForType(new Map(), ct, pools, reqs);
    if (h > best) best = h;
  }
  return best;
}
function slotRemaining(pools, reqs) {
  const types = [...new Set(reqs.map((r) => r.customerTypeId))];
  if (types.length === 0) return 0;
  const ceiling = pools.reduce((n, p) => n + Math.max(0, p.maxConcurrentUses), 0);
  const cart = new Map();
  let total = 0;
  while (total < ceiling) {
    let picked = null, best = 0;
    for (const t of types) {
      const h = headroomForType(cart, t, pools, reqs);
      if (h > best) { best = h; picked = t; }
    }
    if (picked == null) break;
    cart.set(picked, (cart.get(picked) ?? 0) + 1);
    total += 1;
  }
  return total;
}

let fails = 0;
const ok = (n, got, want) => {
  const p = got === want;
  console.log(`${p ? "  PASS " : "  FAIL "} ${n}  got=${got} want=${want}`);
  if (!p) fails++;
};
const cart = (o) => new Map(Object.entries(o));
const pool = (id, max, oos = 0, consumed = 0) => ({
  resourceId: id, maxConcurrentUses: max, outOfServiceCount: oos, consumed,
});
const req = (ct, rid, q = 1) => ({ customerTypeId: ct, resourceId: rid, quantityConsumed: q });

// ---------------------------------------------------------------------------
// Miami UTV: two ALTERNATIVE pools. The whole reason this rewrite exists.
// 3 two-seaters, 1 four-seater, and the four-seater is out of service.
// ---------------------------------------------------------------------------
console.log("\nMiami UTV — alternatives, not an AND-constraint");
const utvPools = [pool("utv2", 3), pool("utv4", 1, 1)];
const utvReqs = [req("2seat", "utv2"), req("4seat", "utv4")];

ok("2-Seat sees its own fleet of 3", headroomForType(new Map(), "2seat", utvPools, utvReqs), 3);
ok("4-Seat is sold out (its one machine is down)", headroomForType(new Map(), "4seat", utvPools, utvReqs), 0);
ok("the dead four-seater does NOT cap the two-seaters", slotRemaining(utvPools, utvReqs), 3);
ok("slot is NOT sold out — this is the whole point", bestTypeRemaining(utvPools, utvReqs) > 0, true);
ok("3 two-seaters fit", cartFits(cart({ "2seat": 3 }), utvPools, utvReqs), true);
ok("4 two-seaters do not", cartFits(cart({ "2seat": 4 }), utvPools, utvReqs), false);
ok("no four-seater fits while it is down", cartFits(cart({ "4seat": 1 }), utvPools, utvReqs), false);

// The old min-across-pools rule returned min(3, 0) = 0 here and killed the tour.
const oldRule = Math.min(3 - 0 - 0, 1 - 1 - 0);
ok("regression guard: the OLD rule would have said 0", oldRule, 0);

console.log("\nMiami UTV — four-seater back in service, mixed cart");
const repaired = [pool("utv2", 3), pool("utv4", 1)];
ok("4-Seat sellable once repaired", headroomForType(new Map(), "4seat", repaired, utvReqs), 1);
ok("mixed cart 1+1 fits", cartFits(cart({ "2seat": 1, "4seat": 1 }), repaired, utvReqs), true);
ok("full mixed cart 3+1 fits", cartFits(cart({ "2seat": 3, "4seat": 1 }), repaired, utvReqs), true);
ok("3+2 does not (only one four-seater)", cartFits(cart({ "2seat": 3, "4seat": 2 }), repaired, utvReqs), false);
ok("holding a four-seater leaves the two-seaters alone",
  headroomForType(cart({ "4seat": 1 }), "2seat", repaired, utvReqs), 3);
ok("holding a two-seater leaves the four-seater alone",
  headroomForType(cart({ "2seat": 3 }), "4seat", repaired, utvReqs), 1);
ok("total sellable across both pools", slotRemaining(repaired, utvReqs), 4);

// ---------------------------------------------------------------------------
// ATV tours: two types SHARING one pool. Must behave exactly as before.
// ---------------------------------------------------------------------------
console.log("\nATV — shared pool, the no-regression case");
const atvPools = [pool("atv", 36)];
const atvReqs = [req("single", "atv"), req("double", "atv")];

ok("Single sees the whole fleet", headroomForType(new Map(), "single", atvPools, atvReqs), 36);
ok("Double sees the whole fleet too", headroomForType(new Map(), "double", atvPools, atvReqs), 36);
ok("but they are NOT additive — 36 machines, not 72", slotRemaining(atvPools, atvReqs), 36);
ok("sold-out scalar matches the old resourceRemaining exactly", bestTypeRemaining(atvPools, atvReqs), 36);
ok("10 singles leave 26 for doubles",
  headroomForType(cart({ single: 10 }), "double", atvPools, atvReqs), 26);
ok("20 + 16 fits exactly", cartFits(cart({ single: 20, double: 16 }), atvPools, atvReqs), true);
ok("20 + 17 busts the shared pool", cartFits(cart({ single: 20, double: 17 }), atvPools, atvReqs), false);

console.log("\nATV — peak concurrent usage from overlapping tours drains it");
const atvBusy = [pool("atv", 36, 0, 29)]; // the Miami 18:00-20:00 case: 29 already out
ok("7 left, not 36", headroomForType(new Map(), "single", atvBusy, atvReqs), 7);
ok("8 does not fit", cartFits(cart({ single: 8 }), atvBusy, atvReqs), false);

// ---------------------------------------------------------------------------
// AND-constraint: one type drawing on two pools at once (Dallas Glow shape).
// ---------------------------------------------------------------------------
console.log("\nGlow tour — one type, two pools required TOGETHER");
const glowPools = [pool("atv", 36), pool("kit", 10, 5)];
const glowReqs = [req("glow", "atv"), req("glow", "kit")];
ok("capped by the scarcer pool", headroomForType(new Map(), "glow", glowPools, glowReqs), 5);
ok("5 fits", cartFits(cart({ glow: 5 }), glowPools, glowReqs), true);
ok("6 does not", cartFits(cart({ glow: 6 }), glowPools, glowReqs), false);
// Both pools show free units, but the type needs both at once, so nothing is sellable.
// This is why sold-out is bestTypeRemaining and not slotRemaining.
const glowDead = [pool("atv", 36), pool("kit", 10, 10)];
ok("dead kit pool ⇒ sold out", bestTypeRemaining(glowDead, glowReqs), 0);
ok("...and nothing is sellable, NOT the 36 free ATVs", slotRemaining(glowDead, glowReqs), 0);
// The Dallas regression: summing free pool units reported 22 ATVs + 10 kits = 32 sellable glow
// rides against a fleet that can produce 10. Shipped to the ad cockpit as real inventory.
ok("glow total is the scarcer pool, not the sum", slotRemaining(glowPools, glowReqs), 5);
ok("...which is emphatically not 36 + 5", slotRemaining(glowPools, glowReqs) === 41, false);

// ---------------------------------------------------------------------------
// Multi-unit consumption + the half-configured tour.
// ---------------------------------------------------------------------------
console.log("\nEdges");
const pairPools = [pool("atv", 7)];
const pairReqs = [req("pair", "atv", 2)];
ok("a type eating 2 units gets floor(7/2)", headroomForType(new Map(), "pair", pairPools, pairReqs), 3);
ok("3 pairs = 6 units, fits", cartFits(cart({ pair: 3 }), pairPools, pairReqs), true);
ok("4 pairs = 8 units, does not", cartFits(cart({ pair: 4 }), pairPools, pairReqs), false);

ok("a type with NO requirement row has zero headroom",
  headroomForType(new Map(), "orphan", atvPools, atvReqs), 0);
ok("...and can never be sold, rather than always fitting",
  cartFits(cart({ orphan: 1 }), atvPools, atvReqs), false);
ok("a tour with no requirements at all sells nothing", slotRemaining(atvPools, []), 0);
ok("...and reads as sold out rather than -Infinity", bestTypeRemaining(atvPools, []), 0);
ok("quantity_consumed 0 is treated as 1, not infinity",
  headroomForType(new Map(), "z", [pool("r", 4)], [req("z", "r", 0)]), 4);
ok("an empty cart always fits", cartFits(new Map(), utvPools, utvReqs), true);
ok("a zero-quantity line is ignored", cartFits(cart({ "4seat": 0 }), utvPools, utvReqs), true);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
