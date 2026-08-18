/**
 * Purge test-mode bookings from a location, leaving imported (FareHarbor) and
 * real bookings intact.
 *
 * Targets bookings that are BOTH:
 *   - not imported (external_ref IS NULL), and
 *   - backed by a payment row (i.e. they went through Stripe checkout)
 *
 * The payment-row condition is the important half. `external_ref IS NULL` alone
 * also matches every future real booking AND would have matched nothing safe
 * during the migration window — an earlier version of this predicate would have
 * deleted the 185 FareHarbor imports. Do not simplify it.
 *
 * Usage:
 *   node --env-file-if-exists=.env.local --import tsx scripts/purge-test-bookings.ts <slug>
 *   ... --commit    (without this it is a dry run)
 */
import { sql } from "drizzle-orm";
import { withTxn } from "../src/lib/db/pool";

const slug = process.argv[2];
const commit = process.argv.includes("--commit");
if (!slug) { console.error("usage: purge-test-bookings.ts <slug> [--commit]"); process.exit(1); }

const TARGET = `
  b.location_id = (select id from locations where slug = '${slug}')
  and b.external_ref is null
  and exists (select 1 from payments p where p.booking_id = b.id)
`;

async function main() {
  await withTxn(async (tx) => {
    const rows: any = await tx.execute(sql.raw(`
      select b.display_number, b.status::text as status, b.created_at::date as created,
             p.stripe_payment_intent_id as pi, p.amount_cents
      from bookings b join payments p on p.booking_id = b.id
      where ${TARGET} order by b.created_at`));
    const targets = rows.rows ?? rows;

    const guard: any = await tx.execute(sql.raw(`
      select count(*)::int as n from bookings b
      where b.location_id = (select id from locations where slug = '${slug}')
        and b.external_ref is not null`));
    const imported = (guard.rows ?? guard)[0].n;

    console.log(`\nLocation: ${slug}`);
    console.log(`Imported bookings that MUST survive: ${imported}`);
    console.log(`\nWill delete ${targets.length} booking(s):`);
    console.table(targets);

    if (targets.some((t: any) => String(t.pi ?? "").startsWith("pi_") === false)) {
      throw new Error("ABORT: a target has no Stripe payment intent — predicate is wrong.");
    }
    if (!commit) { console.log("\nDRY RUN — pass --commit to apply.\n"); return; }

    const del: any = await tx.execute(sql.raw(
      `delete from bookings b where ${TARGET} returning b.id`));
    const deleted = (del.rows ?? del).length;

    const after: any = await tx.execute(sql.raw(`
      select count(*)::int as n from bookings b
      where b.location_id = (select id from locations where slug = '${slug}')
        and b.external_ref is not null`));
    const importedAfter = (after.rows ?? after)[0].n;
    if (importedAfter !== imported) {
      throw new Error(`ABORT+ROLLBACK: imported count changed ${imported} -> ${importedAfter}`);
    }
    console.log(`\nDeleted ${deleted}. Imported bookings still intact: ${importedAfter}\n`);
  });
}
main().then(() => process.exit(0)).catch((e) => { console.error(e.cause?.message ?? e.message); process.exit(1); });
