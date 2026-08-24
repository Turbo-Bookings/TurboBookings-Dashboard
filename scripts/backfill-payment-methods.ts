/**
 * Backfill payments.payment_method_type — and the saved payment methods that went with it.
 *
 * `commitBookingFromIntent` only expanded the PaymentIntent's payment method when it fetched the
 * intent itself. The Stripe webhook passes its own event object, where `payment_method` is a bare
 * string id, so `pm` came back null: no method type recorded and no card saved. That is the path 67%
 * of online bookings take (361 of 539 payments, against 178 through the success page).
 *
 * The write path is fixed (bookingsystem/src/lib/booking/commit.ts). This repairs what was already
 * stored, which matters twice over:
 *   1. a booking with a saved method can have a later fee top-up charged to it — without one the
 *      shortfall is only recoverable in cash at the desk
 *   2. it is the ONLY way to learn the true payment-method mix. Every Link-share figure quoted so far
 *      comes from the success-page sample alone, which is exactly the biased two-thirds we can see.
 *
 * Dry run by default — prints what it would change and writes nothing:
 *   npx tsx scripts/backfill-payment-methods.ts
 *   npx tsx scripts/backfill-payment-methods.ts --commit
 *   npx tsx scripts/backfill-payment-methods.ts --commit --slug=miami --limit=50
 *
 * One Stripe read per payment, so it is chunked and paced. Re-running is safe: it only considers
 * payments still missing a method type, and the payment-method insert is ON CONFLICT DO NOTHING.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import Stripe from "stripe";

const COMMIT = process.argv.includes("--commit");
const SLUG = process.argv.find((a) => a.startsWith("--slug="))?.split("=")[1];
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 1000);

function fromDotenv(key: string): string | undefined {
  for (const f of [".env.production.local", ".env.local"]) {
    try {
      const m = readFileSync(f, "utf8").match(new RegExp(`^${key}="?([^"\\n]+)"?`, "m"));
      if (m?.[1]) return m[1];
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

function databaseUrl(): string {
  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL ||
    fromDotenv("DATABASE_URL_UNPOOLED") ||
    fromDotenv("DATABASE_URL");
  if (!url) {
    throw new Error(
      "No DATABASE_URL. Run `vercel env pull .env.production.local --environment=production` first.",
    );
  }
  return url;
}

type Row = {
  payment_id: string;
  booking_id: string;
  customer_id: string | null;
  pi: string;
  slug: string;
  stripe_account_id: string | null;
};

async function main() {
  const key = process.env.STRIPE_SECRET_KEY || fromDotenv("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const stripe = new Stripe(key);
  const sql = neon(databaseUrl());

  const rows = (await sql.query(
    `SELECT p.id AS payment_id, p.booking_id, b.customer_id,
            p.stripe_payment_intent_id AS pi, l.slug, l.stripe_account_id
       FROM payments p
       JOIN bookings b  ON b.id = p.booking_id
       JOIN locations l ON l.id = b.location_id
      WHERE p.stripe_payment_intent_id IS NOT NULL
        AND p.payment_method_type IS NULL
        ${SLUG ? "AND l.slug = $1" : ""}
      ORDER BY p.created_at DESC
      LIMIT ${LIMIT}`,
    SLUG ? [SLUG] : [],
  )) as Row[];

  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"}${SLUG ? ` · ${SLUG}` : ""}`);
  console.log(`  payments missing a method type : ${rows.length}\n`);

  const byType = new Map<string, number>();
  let saved = 0;
  let reusable = 0;
  const failures: string[] = [];

  for (const r of rows) {
    // Direct charges live on the CONNECTED account, so every read needs its `stripeAccount`. Without
    // it Stripe reports "No such payment_intent" — which reads like missing data rather than a
    // missing header, and would make the whole backfill look like a no-op.
    const opts = r.stripe_account_id ? { stripeAccount: r.stripe_account_id } : undefined;
    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.retrieve(r.pi, { expand: ["payment_method"] }, opts);
    } catch (e) {
      failures.push(`${r.slug} ${r.pi}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const pm = pi.payment_method && typeof pi.payment_method !== "string" ? pi.payment_method : null;
    const type = pm?.type ?? pi.payment_method_types?.[0] ?? null;
    if (!type) continue;
    byType.set(type, (byType.get(type) ?? 0) + 1);

    // A method only helps us later if Stripe ATTACHED it to a customer. An unattached one cannot be
    // charged off-session no matter what type it is, so counting it as coverage would overstate what
    // is actually recoverable.
    const attached = Boolean(pm && pm.customer);
    if (attached) reusable++;

    if (!COMMIT) continue;

    await sql.query(
      `UPDATE payments SET payment_method_type = $1, last4 = coalesce(last4, $2), updated_at = now()
        WHERE id = $3`,
      [type, pm?.card?.last4 ?? null, r.payment_id],
    );

    if (pm && attached && r.customer_id) {
      const res = await sql.query(
        `INSERT INTO payment_methods_on_file
           (customer_id, added_from_booking_id, stripe_payment_method_id, brand, last4, exp_month, exp_year)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (stripe_payment_method_id) DO NOTHING
         RETURNING id`,
        [
          r.customer_id,
          r.booking_id,
          pm.id,
          pm.card?.brand ?? pm.type ?? null,
          pm.card?.last4 ?? null,
          pm.card?.exp_month ?? null,
          pm.card?.exp_year ?? null,
        ],
      );
      if ((res as unknown[]).length > 0) saved++;
    }
  }

  console.log("  method mix (the number nobody has been able to see):");
  for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${t.padEnd(20)} ${String(n).padStart(4)}  ${((n / rows.length) * 100).toFixed(1)}%`);
  }
  console.log(`\n  attached to a customer (chargeable later) : ${reusable} of ${rows.length}`);
  console.log(`  payment methods newly saved              : ${COMMIT ? saved : "(dry run)"}`);
  if (failures.length) {
    console.log(`\n  ${failures.length} could not be read from Stripe:`);
    for (const f of failures.slice(0, 10)) console.log(`    ${f}`);
    if (failures.length > 10) console.log(`    …and ${failures.length - 10} more`);
  }
  if (!COMMIT) console.log("\n  Nothing was written. Re-run with --commit.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
