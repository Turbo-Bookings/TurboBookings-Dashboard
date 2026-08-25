/**
 * Every report in the registry must have the pages and routes it claims.
 *
 *   npx tsx scripts/check-report-routes.ts
 *
 * The registry exists so a report is one entry plus one folder instead of three hand-edited link
 * lists. That removed one class of silent breakage and introduced a smaller one: an entry and a
 * folder are still two things that can disagree, and `csv: true` with no export route renders a
 * download button that 404s. That happened twice — cash and sales-by-user shipped that way.
 *
 * No database, no network. Runs in a second.
 */
import { existsSync } from "node:fs";
import { REPORTS } from "../src/lib/reports/registry";

const BASE = "src/app/locations/[slug]/reports";

let bad = 0;
for (const r of REPORTS) {
  const page = `${BASE}/${r.key}/page.tsx`;
  const csv = `${BASE}/${r.key}/export/route.ts`;

  if (!existsSync(page)) {
    console.log(`  MISSING PAGE   ${r.key.padEnd(18)} — listed on the index, leads nowhere`);
    bad++;
  }
  if (r.csv && !existsSync(csv)) {
    console.log(`  MISSING CSV    ${r.key.padEnd(18)} — the CSV button will 404`);
    bad++;
  }
  if (!r.csv && existsSync(csv)) {
    console.log(`  ORPHAN CSV     ${r.key.padEnd(18)} — route exists but no button offers it`);
    bad++;
  }
  if (existsSync(page) && (!r.csv || existsSync(csv))) {
    console.log(`  ok             ${r.key.padEnd(18)} ${r.csv ? "page + csv" : "page"}`);
  }
}

console.log(
  bad === 0
    ? `\n${REPORTS.length} reports, all reachable.\n`
    : `\n${bad} problem${bad === 1 ? "" : "s"}.\n`,
);
process.exit(bad === 0 ? 0 : 1);
