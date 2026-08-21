/**
 * Backfill customers.phone_e164 to real E.164.
 *
 * The column was named phone_e164 from day one but the checkout and the
 * manual-booking path wrote whatever the customer typed. Bare 10-digit numbers
 * hash without a country code, so Meta's advanced matching and CAPI never
 * matched on phone and event match quality suffered. The write paths are fixed
 * (lib/phone.ts); this repairs the rows already stored.
 *
 * Dry run by default — prints exactly what would change and touches nothing:
 *   npx tsx scripts/backfill-phone-e164.ts
 *   npx tsx scripts/backfill-phone-e164.ts --commit
 *   npx tsx scripts/backfill-phone-e164.ts --commit --slug=dtown
 *
 * Rows that can't be normalized confidently are LEFT ALONE and listed, not
 * blanked: an unparseable number is still one the operator can call.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { normalizePhone } from "../src/lib/phone";

const COMMIT = process.argv.includes("--commit");
const SLUG = process.argv.find((a) => a.startsWith("--slug="))?.split("=")[1];

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

  const rows = (await sql.query(
    `SELECT c.id, c.phone_e164, l.slug
       FROM customers c
       JOIN locations l ON l.id = c.location_id
      WHERE coalesce(c.phone_e164, '') <> ''
        AND c.phone_e164 NOT LIKE '+%'
        ${SLUG ? "AND l.slug = $1" : ""}
      ORDER BY l.slug`,
    SLUG ? [SLUG] : [],
  )) as { id: string; phone_e164: string; slug: string }[];

  const fixable: { id: string; slug: string; to: string }[] = [];
  const skipped: { slug: string; len: number }[] = [];
  for (const r of rows) {
    const to = normalizePhone(r.phone_e164);
    if (to) fixable.push({ id: r.id, slug: r.slug, to });
    else skipped.push({ slug: r.slug, len: r.phone_e164.length });
  }

  const byLocation = new Map<string, number>();
  for (const f of fixable) byLocation.set(f.slug, (byLocation.get(f.slug) ?? 0) + 1);

  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"}${SLUG ? ` · ${SLUG}` : ""}`);
  console.log(`  non-E.164 rows found : ${rows.length}`);
  console.log(`  normalizable         : ${fixable.length}`);
  for (const [slug, n] of [...byLocation].sort()) console.log(`      ${slug}: ${n}`);
  console.log(`  left alone           : ${skipped.length}`);
  for (const s of skipped) console.log(`      ${s.slug}: unparseable, ${s.len} chars`);

  if (!COMMIT) {
    console.log("\nNothing written. Re-run with --commit to apply.");
    return;
  }

  let done = 0;
  for (const f of fixable) {
    // Guarded on the pre-image so a concurrent write from the live checkout
    // can't be clobbered by this backfill.
    await sql.query(
      `UPDATE customers SET phone_e164 = $1, updated_at = now()
        WHERE id = $2 AND phone_e164 NOT LIKE '+%'`,
      [f.to, f.id],
    );
    done++;
  }
  console.log(`\nUpdated ${done} row(s).`);

  const left = (await sql.query(
    `SELECT count(*) AS n FROM customers
      WHERE coalesce(phone_e164,'') <> '' AND phone_e164 NOT LIKE '+%'`,
  )) as { n: string }[];
  console.log(`Remaining non-E.164 across all locations: ${left[0].n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
