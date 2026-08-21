/**
 * Who has accepted what, and who still owes it.
 *
 *   npm run terms:status
 *
 * READ ONLY. This exists so the acceptance record can be produced by anyone —
 * including a lawyer asking "prove this operator agreed" — without going
 * through an engineer or a SQL console.
 */
import { desc } from "drizzle-orm";
import { getDb, termsAcceptances } from "@/lib/db";
import { GATED_DOCUMENTS } from "@/lib/legal/documents";

async function main() {
  console.log("— DOCUMENTS —");
  for (const d of GATED_DOCUMENTS) {
    console.log(
      `  ${d.key}: ${d.version ? `version ${d.version}` : "NOT PUBLISHED — nobody is gated"}`,
    );
    if (d.url) console.log(`    ${d.url}`);
  }

  const rows = await getDb()
    .select()
    .from(termsAcceptances)
    .orderBy(desc(termsAcceptances.acceptedAt));

  console.log(`\n— ACCEPTANCES (${rows.length}) —`);
  if (rows.length === 0) {
    console.log(
      "  none yet. Expected while every document is unpublished — set a\n" +
        "  `version` in src/lib/legal/documents.ts to start collecting them.",
    );
  }
  for (const r of rows) {
    console.log(
      `  ${r.acceptedAt.toISOString()}  ${r.document}@${r.version}  ` +
        `${r.userEmail ?? r.userId}  ip=${r.ipAddress ?? "—"}`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
