/**
 * Reverse platform fees that were invented at reschedule time and pushed onto customer balances.
 *
 * `syncPlatformFee` used to recompute the fee as 6% of the booking's GROSS `subtotal_cents` on every
 * reschedule, exempting only FareHarbor imports. Walk-in and Groupon/OTA bookings deliberately store
 * `platform_fee_cents = 0` (pricing/breakdown.ts charges a fee only when the payment method is a
 * card), so moving one invented the whole 6% — computed off the RACK price, not the price the
 * customer actually agreed. With no card on file it went straight onto `balance_due_cents` for the
 * desk to collect.
 *
 * Miami #0394 is the shape of it: rack $380.00, sold $259.38, paid in full, and then a $22.80
 * balance appeared out of a same-price reschedule. #0286 was hit twice, $45.60, because
 * `platform_fee_cents` only advances when the money is collected — so the identical target was
 * recomputed and charged again on the next move.
 *
 * The code fix (platformFee.ts, now measuring the INCREASE rather than the whole subtotal) stops it
 * recurring. This reverses what is already on the books.
 *
 *   npx tsx scripts/reverse-phantom-platform-fees.ts            # dry run, prints every booking
 *   npx tsx scripts/reverse-phantom-platform-fees.ts --commit
 *
 * SCOPE — deliberately narrow. Only bookings where the fee was never collected and never legitimately
 * owed:
 *
 *     platform_fee_uncollected_cents > 0    the fee is sitting on the customer's balance
 *     AND platform_fee_cents = 0            nothing was ever actually collected
 *     AND external_ref NOT LIKE 'fh:%'      imports have their own write-off path
 *
 * NOT in scope: bookings where a fee top-up was genuinely CHARGED to a card off the discount base
 * (miami #0345 +$0.60, dtown #0647 +$1.20, …). Those are real Stripe charges; reversing them means
 * issuing refunds, which is a decision and a separate action, not a balance edit. They are reported
 * at the end so they are not silently forgotten.
 */
import { readFileSync } from "node:fs";
import { and, eq, gt, notLike, or, isNull, sql } from "drizzle-orm";
import { withTxn, type Tx } from "../src/lib/db/pool";
import { auditLog, bookings, locations } from "../src/lib/db/schema";

for (const f of [".env.production.local", ".env.local"]) {
  try {
    const raw = readFileSync(f, "utf8");
    for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
      const m = raw.match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
      if (m?.[1] && !process.env[key]) process.env[key] = m[1];
    }
  } catch {}
}

const COMMIT = process.argv.includes("--commit");
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

async function run(tx: Tx) {
  const rows = await tx
    .select({
      id: bookings.id,
      ref: bookings.displayNumber,
      slug: locations.slug,
      locationId: bookings.locationId,
      status: bookings.status,
      rack: bookings.subtotalCents,
      sold: bookings.subtotalCentsOverride,
      feeCents: bookings.platformFeeCents,
      uncollected: bookings.platformFeeUncollectedCents,
      total: bookings.totalCents,
      paid: bookings.depositPaidCents,
      balance: bookings.balanceDueCents,
    })
    .from(bookings)
    .innerJoin(locations, eq(locations.id, bookings.locationId))
    .where(
      and(
        gt(bookings.platformFeeUncollectedCents, 0),
        eq(bookings.platformFeeCents, 0),
        or(isNull(bookings.externalRef), notLike(bookings.externalRef, "fh:%")),
      ),
    )
    .orderBy(locations.slug, bookings.displayNumber);

  if (rows.length === 0) {
    console.log("\n  Nothing to reverse — no booking carries an uncollected fee it never owed.\n");
    return;
  }

  console.log(`\n  ${rows.length} booking(s) carrying an invented platform fee:\n`);
  let total = 0;
  for (const r of rows) {
    total += r.uncollected;
    const newTotal = r.total - r.uncollected;
    const newBalance = r.balance - r.uncollected;
    console.log(
      `  ${r.slug.padEnd(6)} #${r.ref}  ${r.status.padEnd(7)}` +
        `  rack ${usd(r.rack).padStart(8)}` +
        `  sold ${(r.sold == null ? "—" : usd(r.sold)).padStart(8)}` +
        `  fee ${usd(r.uncollected).padStart(7)}` +
        `   balance ${usd(r.balance).padStart(8)} → ${usd(newBalance)}`,
    );
    // A negative balance would mean we owe THEM money, which this bug cannot have created — it only
    // ever added. Stop rather than write something that needs a refund to unwind.
    if (newBalance < 0 || newTotal < 0)
      throw new Error(
        `#${r.ref}: reversing ${usd(r.uncollected)} would leave balance ${usd(newBalance)} / total ${usd(newTotal)} — refusing`,
      );
  }
  console.log(`\n  TOTAL to remove from customer balances: ${usd(total)}`);

  if (!COMMIT) {
    console.log(`\n  dry run — nothing written. Re-run with --commit.\n`);
    return;
  }

  for (const r of rows) {
    await tx
      .update(bookings)
      .set({
        totalCents: r.total - r.uncollected,
        balanceDueCents: r.balance - r.uncollected,
        platformFeeUncollectedCents: 0,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, r.id));

    await tx.insert(auditLog).values({
      locationId: r.locationId,
      userId: null, // script, not a person
      action: "catalog.booking.platform_fee_reversed",
      summary: `Removed ${usd(r.uncollected)} platform fee that was added at reschedule and never owed`,
      payload: {
        bookingId: r.id,
        displayNumber: r.ref,
        reversedCents: r.uncollected,
        totalFrom: r.total,
        totalTo: r.total - r.uncollected,
        balanceFrom: r.balance,
        balanceTo: r.balance - r.uncollected,
        reason:
          "syncPlatformFee charged 6% of gross rack subtotal on a booking with platform_fee_cents = 0",
      },
    });
  }

  const left = await tx.execute(sql`
    SELECT count(*)::int AS n, coalesce(sum(platform_fee_uncollected_cents), 0)::int AS cents
    FROM bookings b
    WHERE b.platform_fee_uncollected_cents > 0 AND b.platform_fee_cents = 0
      AND coalesce(b.external_ref, '') NOT LIKE 'fh:%'`);
  const l = ((left.rows ?? left) as { n: number; cents: number }[])[0];
  if (l.n !== 0) throw new Error(`post-check: ${l.n} booking(s) still carry ${usd(l.cents)}`);
  console.log(`\n  COMMITTED — ${rows.length} booking(s), ${usd(total)} removed. None remaining.`);
}

async function reportChargedOnDiscount() {
  // Separate concern, reported not fixed: fee top-ups that were genuinely taken from a card, off the
  // gross base, for bookings whose value never changed. Undoing these means refunding.
  const { getDb } = await import("../src/lib/db/index");
  const r = await getDb().execute(sql`
    SELECT l.slug, b.display_number AS ref, b.discount_cents, p.amount_cents, p.created_at::date AS on_date
    FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    JOIN locations l ON l.id = b.location_id
    WHERE p.kind = 'fee_topup' AND p.status = 'succeeded' AND b.discount_cents > 0
    ORDER BY l.slug, b.display_number`);
  const rows = (r.rows ?? r) as {
    slug: string; ref: string; discount_cents: number; amount_cents: number; on_date: string;
  }[];
  if (rows.length === 0) return;
  const sum = rows.reduce((n, x) => n + Number(x.amount_cents), 0);
  console.log(
    `\n  ⚠️  SEPARATE ISSUE — ${rows.length} fee top-up(s) totalling ${usd(sum)} were CHARGED to a card`,
  );
  console.log(`      off the gross subtotal, on discounted bookings whose value did not change.`);
  console.log(`      These are real Stripe charges. Reversing them means refunds — not done here.`);
  for (const x of rows)
    console.log(
      `      ${x.slug.padEnd(6)} #${x.ref}  discount ${usd(Number(x.discount_cents))}  charged ${usd(Number(x.amount_cents))}  ${x.on_date}`,
    );
}

async function main() {
  console.log(`\n=== reverse platform fees invented at reschedule ===`);
  await withTxn(run);
  await reportChargedOnDiscount();
  console.log("");
}

main().catch((e) => {
  console.error("\n  FAILED —", e instanceof Error ? e.message : e);
  console.error("  nothing was written (single transaction).\n");
  process.exit(1);
});
