/**
 * The evidence for the Link decision.
 *
 * Background: our 6% rises when a booking's value rises after checkout, and the difference has to be
 * charged separately to whatever the customer paid with. That only works if Stripe attached a
 * reusable payment method. Link looked like the culprit — 1 method saved in 60, against 113 of 113
 * for plain card — and removing it from checkout was on the table.
 *
 * That number could not be trusted. Two thirds of payments never recorded a method type at all (the
 * webhook path did not expand the PaymentIntent, fixed 2026-08-24), so the Link share came from the
 * one third we could see, which is not a random third. And the `if (pm?.card)` gate meant a Link
 * method was DISCARDED even when Stripe had attached it — so "1 in 60" measured our bug, not Link.
 *
 * Both are fixed. This prints what the fixed code has actually produced since, which is the only
 * basis on which to decide.
 *
 *   npx tsx scripts/payment-method-report.ts              # since the fix
 *   npx tsx scripts/payment-method-report.ts --since=2026-09-01
 *
 * Read it like this:
 *   - "share of checkouts" says how much traffic removing Link would disrupt
 *   - "kept a reusable method" says whether Link is actually worse than card, now that we save it
 *   - "top-up outcomes" is the only column that measures the thing we care about: does an
 *     off-session charge on a Link method SUCCEED? Stripe's behaviour here varies and no amount of
 *     reasoning substitutes for the attempts.
 *
 * If Link keeps a method at a rate near card's and its top-ups succeed, there is nothing to fix and
 * the answer is to leave checkout alone. If it keeps methods but the charges fail, the fee is only
 * recoverable at the desk — compare that cost against the share of checkouts before removing it.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

// The commit that fixed both bugs shipped this day. Anything earlier measures the old behaviour and
// would poison the comparison.
const FIX_DATE = "2026-08-24";
const SINCE = process.argv.find((a) => a.startsWith("--since="))?.split("=")[1] ?? FIX_DATE;

function databaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  for (const f of [".env.production.local", ".env.local"]) {
    try {
      const raw = readFileSync(f, "utf8");
      const m =
        raw.match(/^DATABASE_URL_UNPOOLED="?([^"\n]+)"?/m) ??
        raw.match(/^DATABASE_URL="?([^"\n]+)"?/m);
      if (m?.[1]) return m[1];
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    "No DATABASE_URL. Run `vercel env pull .env.production.local --environment=production` first.",
  );
}

const pct = (n: number, d: number) => (d === 0 ? "  —  " : `${((n / d) * 100).toFixed(1)}%`);

async function main() {
  const sql = neon(databaseUrl());

  const mix = (await sql.query(
    `SELECT coalesce(p.payment_method_type, '(not recorded)') AS type,
            count(*) AS n,
            count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM payment_methods_on_file m
               WHERE m.customer_id = b.customer_id AND NOT m.archived
            )) AS with_method
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
      WHERE p.stripe_payment_intent_id IS NOT NULL
        AND p.created_at >= $1
      GROUP BY 1 ORDER BY 2 DESC`,
    [SINCE],
  )) as { type: string; n: number; with_method: number }[];

  const total = mix.reduce((s, r) => s + Number(r.n), 0);

  console.log(`Payments since ${SINCE} — ${total} total\n`);
  console.log("  method                share of checkouts    kept a reusable method");
  for (const r of mix) {
    const n = Number(r.n);
    console.log(
      `  ${r.type.padEnd(20)} ${pct(n, total).padStart(10)} (${String(n).padStart(4)})` +
        `      ${pct(Number(r.with_method), n).padStart(6)}`,
    );
  }

  // The outcome that actually decides it. Every top-up attempt is audited, successful or not.
  const outcomes = (await sql.query(
    `SELECT (a.payload->>'charged')::boolean AS charged,
            a.payload->>'uncollectedReason' AS reason,
            count(*) AS n
       FROM audit_log a
      WHERE a.action = 'catalog.booking.platform_fee_topup'
        AND a.created_at >= $1
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    [SINCE],
  )) as { charged: boolean; reason: string | null; n: number }[];

  console.log(`\n  top-up outcomes since ${SINCE}:`);
  if (outcomes.length === 0) {
    console.log("    none yet — no booking has risen in value since the fix.");
    console.log("    WITHOUT THESE THERE IS NO DECISION TO MAKE. Wait for more data.");
  }
  for (const o of outcomes) {
    console.log(
      `    ${o.charged ? "CHARGED " : "FAILED  "} ${String(o.n).padStart(3)}  ${o.reason ?? ""}`,
    );
  }

  const outstanding = (await sql.query(
    `SELECT count(*) AS n, coalesce(sum(platform_fee_uncollected_cents), 0) AS cents
       FROM bookings
      WHERE platform_fee_uncollected_cents > 0 AND platform_fee_written_off_at IS NULL`,
  )) as { n: number; cents: number }[];
  console.log(
    `\n  still outstanding: ${outstanding[0].n} bookings, $${(Number(outstanding[0].cents) / 100).toFixed(2)}`,
  );
  console.log("  (FareHarbor imports are auto-written-off and excluded — this is all ours.)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
