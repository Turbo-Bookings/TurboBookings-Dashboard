/**
 * Split Miami's single UTV pool into a 2-Seater fleet and a 4-Seater fleet.
 *
 * Miami sells a "2-Seat UTV" and a "4-Seat UTV" option on both UTV tours, correctly priced, but
 * BOTH consume from one undifferentiated pool of 4. The operator owns 3 two-seaters and 1
 * four-seater, so today the system will happily sell 3 four-seaters against a fleet of one. This
 * is the data half of that fix; the capacity math had to become per-customer-type first, or the
 * scarcer pool would simply cap the whole tour (see src/lib/booking/capacity.ts).
 *
 *   npx tsx scripts/split-miami-utv-fleet.ts              # dry run, prints the plan
 *   npx tsx scripts/split-miami-utv-fleet.ts --commit
 *
 * Done as a script rather than through the admin UI because `saveItemResourceRequirements` runs on
 * neon-http, which has no transactions: it writes one cell at a time, per item. Repointing through
 * the grid would leave a window where a priced rider type has NO requirement row — and a type with
 * no requirement row consumes nothing, which is unmetered oversell on a live tour. It is also two
 * separate item saves, so between them the 1-Hour and 2-Hour tours would stop competing for the
 * same machines. Miami's median booking lead time is 0.2 days; that window is not theoretical.
 *
 * Everything below runs in ONE transaction, so a failure leaves the old pool exactly as it was.
 *
 * Reversal (also one transaction): recreate "UTVs" with max 4 / oos 1, repoint the four
 * resource_requirements rows back to it, delete the two new pools.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { withTxn, type Tx } from "../src/lib/db/pool";
import {
  customerTypes,
  items,
  locations,
  resourceRequirements,
  resources,
} from "../src/lib/db/schema";

const COMMIT = process.argv.includes("--commit");
const SLUG = "miami";
const OLD_POOL = "UTVs";

// Operator-confirmed 2026-08-29: three two-seaters, one four-seater, and the machine currently out
// of service is the FOUR-seater. Note the arithmetic — old pool was max 4 / oos 1 = 3 serviceable,
// and 3 + 0 serviceable here is the same 3. The split must not quietly hand the fleet a fourth
// sellable machine.
const NEW_POOLS = [
  { name: "2-Seat UTVs", customerType: "2-Seat UTV", maxConcurrentUses: 3, outOfServiceCount: 0 },
  { name: "4-Seat UTVs", customerType: "4-Seat UTV", maxConcurrentUses: 1, outOfServiceCount: 1 },
];

const UTV_ITEMS = ["1-Hour UTV Tour", "2-Hour UTV Tour"];

async function run(tx: Tx) {
  const loc = (
    await tx.select({ id: locations.id }).from(locations).where(eq(locations.slug, SLUG)).limit(1)
  )[0];
  if (!loc) throw new Error(`location "${SLUG}" not found`);

  const tours = await tx
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.locationId, loc.id), inArray(items.name, UTV_ITEMS)));
  if (tours.length !== UTV_ITEMS.length)
    throw new Error(`expected ${UTV_ITEMS.length} UTV tours, found ${tours.length}`);
  const tourIds = tours.map((t) => t.id);

  // ── Precondition 1: no checkout in flight on these tours ────────────────────────────────────
  //
  // The one genuinely damaging outcome of this migration is an in-flight PaymentIntent committing
  // after the split: a basket of 2 four-seaters was legal before and is infeasible after, so
  // commit.ts throws OversellError and the webhook REFUNDS a customer who has already paid. Every
  // online checkout takes a seat_hold before the PaymentIntent is created, so zero live holds on
  // these tours means zero in-flight payments for them.
  const held = await tx.execute(sql`
    SELECT count(*)::int AS n
    FROM seat_holds h
    JOIN availabilities a ON a.id = h.availability_id
    WHERE a.item_id = ANY(ARRAY[${sql.join(tourIds.map((id) => sql`${id}::uuid`), sql`, `)}])
      AND h.expires_at > now()
  `);
  const liveHolds = Number((held.rows ?? (held as unknown as { n: number }[]))[0]?.n ?? 0);
  if (liveHolds > 0)
    throw new Error(
      `${liveHolds} live checkout hold(s) on the UTV tours — someone is mid-payment. ` +
        `Holds expire after 10 minutes; wait and re-run.`,
    );

  // ── Precondition 2: the shape is exactly what we think it is ────────────────────────────────
  const old = (
    await tx
      .select()
      .from(resources)
      .where(and(eq(resources.locationId, loc.id), eq(resources.name, OLD_POOL)))
      .limit(1)
  )[0];
  if (!old) {
    console.log(`  pool "${OLD_POOL}" not found — already split? Nothing to do.`);
    return;
  }

  const reqs = await tx
    .select({
      id: resourceRequirements.id,
      itemId: resourceRequirements.itemId,
      customerTypeId: resourceRequirements.customerTypeId,
      resourceId: resourceRequirements.resourceId,
      quantityConsumed: resourceRequirements.quantityConsumed,
      ctName: customerTypes.singular,
      itemName: items.name,
    })
    .from(resourceRequirements)
    .innerJoin(customerTypes, eq(customerTypes.id, resourceRequirements.customerTypeId))
    .innerJoin(items, eq(items.id, resourceRequirements.itemId))
    .where(inArray(resourceRequirements.itemId, tourIds));

  if (reqs.length !== 4)
    throw new Error(`expected 4 resource requirements on the UTV tours, found ${reqs.length}`);
  const wrong = reqs.filter((r) => r.resourceId !== old.id || r.quantityConsumed !== 1);
  if (wrong.length)
    throw new Error(
      `expected all 4 requirements to consume 1 x "${OLD_POOL}"; ` +
        `these do not: ${wrong.map((w) => `${w.itemName}/${w.ctName}`).join(", ")}`,
    );

  const cts = await tx
    .select({ id: customerTypes.id, singular: customerTypes.singular })
    .from(customerTypes)
    .where(
      and(
        eq(customerTypes.locationId, loc.id),
        inArray(customerTypes.singular, NEW_POOLS.map((p) => p.customerType)),
      ),
    );
  const ctByName = new Map(cts.map((c) => [c.singular, c.id]));
  for (const p of NEW_POOLS)
    if (!ctByName.has(p.customerType))
      throw new Error(`customer type "${p.customerType}" not found at ${SLUG}`);

  console.log(`\n  BEFORE`);
  console.log(
    `    pool "${old.name}" — ${old.maxConcurrentUses} total, ${old.outOfServiceCount} out of service, ` +
      `${old.maxConcurrentUses - old.outOfServiceCount} serviceable`,
  );
  for (const r of reqs) console.log(`      ${r.itemName} / ${r.ctName} -> 1 x ${old.name}`);

  const maxSort = (
    await tx
      .select({ s: resources.sortOrder })
      .from(resources)
      .where(eq(resources.locationId, loc.id))
  ).reduce((m, r) => Math.max(m, r.s), 0);

  console.log(`\n  AFTER`);
  let serviceable = 0;
  for (const p of NEW_POOLS) {
    serviceable += p.maxConcurrentUses - p.outOfServiceCount;
    console.log(
      `    pool "${p.name}" — ${p.maxConcurrentUses} total, ${p.outOfServiceCount} out of service, ` +
        `${p.maxConcurrentUses - p.outOfServiceCount} serviceable`,
    );
    for (const t of tours) console.log(`      ${t.name} / ${p.customerType} -> 1 x ${p.name}`);
  }
  console.log(`    pool "${old.name}" — DELETED`);
  const before = old.maxConcurrentUses - old.outOfServiceCount;
  console.log(
    `\n  serviceable machines: ${before} -> ${serviceable}` +
      (before === serviceable ? "  (unchanged, as intended)" : "  ⚠️ CHANGED — check this"),
  );

  if (!COMMIT) {
    console.log(`\n  dry run — nothing written. Re-run with --commit.`);
    return;
  }

  const newIds = new Map<string, string>();
  for (const [i, p] of NEW_POOLS.entries()) {
    const inserted = await tx
      .insert(resources)
      .values({
        locationId: loc.id,
        name: p.name,
        maxConcurrentUses: p.maxConcurrentUses,
        outOfServiceCount: p.outOfServiceCount,
        sortOrder: maxSort + 1 + i,
      })
      .returning({ id: resources.id });
    newIds.set(p.customerType, inserted[0].id);
  }

  // Delete + insert rather than UPDATE so the new rows carry a fresh created_at. Safe here only
  // because it is all one transaction; the unique index is (item_id, customer_type_id, resource_id),
  // so the new triples would not have collided anyway.
  await tx.delete(resourceRequirements).where(inArray(resourceRequirements.itemId, tourIds));
  for (const t of tours) {
    for (const p of NEW_POOLS) {
      await tx.insert(resourceRequirements).values({
        itemId: t.id,
        customerTypeId: ctByName.get(p.customerType)!,
        resourceId: newIds.get(p.customerType)!,
        quantityConsumed: 1,
      });
    }
  }

  // Nothing references it now: resource_requirements.resource_id is the only FK onto resources.
  // Deleted rather than retired because ResourceForm requires max >= 1, so a retired pool would sit
  // in the operator's Resources list forever and appear as a dead column in every tour's grid.
  await tx.delete(resources).where(eq(resources.id, old.id));

  const after = await tx.execute(sql`
    SELECT r.name AS pool, i.name AS tour, ct.singular AS option, rr.quantity_consumed AS q
    FROM resource_requirements rr
    JOIN resources r ON r.id = rr.resource_id
    JOIN items i ON i.id = rr.item_id
    JOIN customer_types ct ON ct.id = rr.customer_type_id
    WHERE rr.item_id = ANY(ARRAY[${sql.join(tourIds.map((id) => sql`${id}::uuid`), sql`, `)}])
    ORDER BY i.name, ct.singular
  `);
  const rows = (after.rows ?? after) as { pool: string; tour: string; option: string; q: number }[];
  if (rows.length !== 4) throw new Error(`post-check: expected 4 rows, got ${rows.length}`);
  console.log(`\n  COMMITTED`);
  for (const r of rows) console.log(`    ${r.tour} / ${r.option} -> ${r.q} x ${r.pool}`);
}

async function main() {
  console.log(`\n=== ${SLUG}: split "${OLD_POOL}" into per-size fleets ===`);
  await withTxn(run);
  console.log("");
}

main().catch((e) => {
  console.error("\n  FAILED —", e instanceof Error ? e.message : e);
  console.error("  nothing was written (single transaction).\n");
  process.exit(1);
});
