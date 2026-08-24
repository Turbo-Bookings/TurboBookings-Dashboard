/**
 * Write off the platform fee we could never have collected on FareHarbor-era bookings.
 *
 * These came in through the CSV import at each location's cutover. They have no Stripe payment
 * behind them, so a fee top-up has nothing to charge and no retry can ever succeed. They sat on the
 * uncollected-fees report as 21 of 27 rows and $612.00 of $649.80 — burying the six bookings that
 * actually came through our system and are worth acting on.
 *
 * `syncPlatformFee` now stamps the write-off as it records the shortfall, so nothing new arrives
 * here. This clears what predates that.
 *
 * Written off ≠ erased: `platform_fee_uncollected_cents` is left alone, only
 * `platform_fee_written_off_at` is stamped, so what the cutover cost stays on the books.
 *
 * Dry run by default:
 *   npx tsx scripts/writeoff-fareharbor-fees.ts
 *   npx tsx scripts/writeoff-fareharbor-fees.ts --commit
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const COMMIT = process.argv.includes("--commit");

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

async function main() {
  const sql = neon(databaseUrl());

  const rows = (await sql.query(`
    SELECT l.slug, b.display_number, b.platform_fee_uncollected_cents AS cents
      FROM bookings b JOIN locations l ON l.id = b.location_id
     WHERE b.platform_fee_uncollected_cents > 0
       AND b.platform_fee_written_off_at IS NULL
       AND b.external_ref LIKE 'fh:%'
     ORDER BY l.slug, b.display_number`)) as {
    slug: string;
    display_number: string;
    cents: number;
  }[];

  const total = rows.reduce((s, r) => s + r.cents, 0);
  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"}`);
  console.log(`  FareHarbor rows still showing as outstanding : ${rows.length}`);
  console.log(`  total                                        : $${(total / 100).toFixed(2)}\n`);
  for (const r of rows) {
    console.log(`    ${r.slug.padEnd(7)} #${r.display_number.padEnd(10)} $${(r.cents / 100).toFixed(2)}`);
  }

  if (!COMMIT) {
    console.log("\n  Nothing was written. Re-run with --commit.");
    return;
  }

  const res = (await sql.query(`
    UPDATE bookings SET platform_fee_written_off_at = now(), updated_at = now()
     WHERE platform_fee_uncollected_cents > 0
       AND platform_fee_written_off_at IS NULL
       AND external_ref LIKE 'fh:%'
     RETURNING id`)) as unknown[];
  console.log(`\n  written off: ${res.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
