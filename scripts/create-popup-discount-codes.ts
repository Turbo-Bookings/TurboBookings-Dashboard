/**
 * Create the `RIDE10` discount code the email-capture popups hand out, and point Miami's popup at it.
 *
 * WHY THIS EXISTS — a live promise that could not be kept.
 *
 * `popup_config.incentive_code` for Dallas has read `RIDE10` since the popup went live on 2026-08-18.
 * The popup reveals that code to every subscriber inline. There was no `RIDE10` row in
 * `discount_codes` — in any location, in any case. Only three codes existed system-wide
 * (dtown/SAVE20, miami/TAKEOVER10, miami/TAKEOVER20).
 *
 * `resolveDiscount` matches on `upper(code) = upper(input)` scoped to the location, so every one of
 * the 1,081 Dallas subscribers who tried RIDE10 got "Code not found" at checkout. Eighteen days of
 * "Get $10 off Your Ride!" that the checkout refused — on an operator client's site.
 *
 * Miami had the mirror-image failure: a fully authored, enabled popup that never rendered at all,
 * because `siteConfig.customBooking` was never set after the 2026-08-21 cutover, so `EmailPopup`
 * returned on its first line. Zero Miami rows have ever reached `leads`.
 *
 *   npx tsx scripts/create-popup-discount-codes.ts            # dry run, prints the plan
 *   npx tsx scripts/create-popup-discount-codes.ts --commit
 *
 * `apply_mode = 'order_total'` is deliberate and was specified by the operator: $10 off the ENTIRE
 * purchase, not per unit. `per_item` multiplies the amount by rider quantity (discount.ts:78-84), so
 * on a 4-rider booking it would give away $40 instead of $10.
 *
 * Idempotent: skips any (location, code) pair that already exists, and never edits an existing row —
 * an already-live code may have been changed deliberately.
 */
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { withTxn, type Tx } from "../src/lib/db/pool";
import { auditLog, discountCodes, locations, popupConfig } from "../src/lib/db/schema";

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
const CODE = "RIDE10";
const AMOUNT_CENTS = 1000;
const SLUGS = ["dtown", "miami"] as const;
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

async function run(tx: Tx) {
  for (const slug of SLUGS) {
    const loc = (
      await tx.select({ id: locations.id }).from(locations).where(eq(locations.slug, slug)).limit(1)
    )[0];
    if (!loc) throw new Error(`location "${slug}" not found`);

    // --- the code itself ---
    const existing = (
      await tx
        .select({ id: discountCodes.id, amountValue: discountCodes.amountValue, active: discountCodes.active })
        .from(discountCodes)
        .where(
          and(eq(discountCodes.locationId, loc.id), sql`upper(${discountCodes.code}) = ${CODE}`),
        )
        .limit(1)
    )[0];

    if (existing) {
      console.log(
        `  ${slug.padEnd(6)} ${CODE} already exists (${usd(existing.amountValue)}, active=${existing.active}) — left untouched`,
      );
    } else {
      console.log(`  ${slug.padEnd(6)} + create ${CODE}  ${usd(AMOUNT_CENTS)} off order total, unlimited uses`);
      if (COMMIT) {
        await tx.insert(discountCodes).values({
          locationId: loc.id,
          code: CODE,
          amountKind: "fixed",
          amountValue: AMOUNT_CENTS,
          applyMode: "order_total",
          active: true,
        });
        await tx.insert(auditLog).values({
          locationId: loc.id,
          userId: null,
          action: "catalog.discount_code.created",
          summary: `Created ${CODE} — ${usd(AMOUNT_CENTS)} off order total, for the email-capture popup`,
          payload: {
            code: CODE,
            amountKind: "fixed",
            amountValue: AMOUNT_CENTS,
            applyMode: "order_total",
            reason:
              "popup_config advertised this code with no matching discount_codes row; checkout returned 'Code not found'",
          },
        });
      }
    }

    // --- point the popup at it ---
    const pc = (
      await tx
        .select({ id: popupConfig.id, code: popupConfig.incentiveCode, headline: popupConfig.headline })
        .from(popupConfig)
        .where(eq(popupConfig.locationId, loc.id))
        .limit(1)
    )[0];
    if (!pc) {
      console.log(`  ${slug.padEnd(6)}   (no popup_config row — nothing to point)`);
      continue;
    }
    if (pc.code === CODE) {
      console.log(`  ${slug.padEnd(6)}   popup already hands out ${CODE}`);
      continue;
    }
    console.log(
      `  ${slug.padEnd(6)}   popup incentive_code: ${pc.code ?? "(none)"} → ${CODE}` +
        (slug === "miami" ? `, headline: "${pc.headline}" → "Get $10 off Your Tour!"` : ""),
    );
    if (COMMIT) {
      await tx
        .update(popupConfig)
        .set({
          incentiveCode: CODE,
          // Copy must state the actual offer. A vague headline is how Dallas ended up advertising
          // "$10 off" against a code that did not exist for eighteen days.
          ...(slug === "miami" ? { headline: "Get $10 off Your Tour!" } : {}),
          updatedAt: new Date(),
        })
        .where(eq(popupConfig.id, pc.id));
    }
  }

  if (!COMMIT) {
    console.log(`\n  dry run — nothing written. Re-run with --commit.\n`);
    return;
  }

  // Post-check: every advertised code must now resolve, in every location that advertises one.
  const bad = await tx.execute(sql`
    SELECT l.slug, p.incentive_code
    FROM popup_config p
    JOIN locations l ON l.id = p.location_id
    WHERE p.enabled AND p.incentive_code IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM discount_codes d
        WHERE d.location_id = p.location_id
          AND upper(d.code) = upper(p.incentive_code)
          AND d.active
      )`);
  const rows = (bad.rows ?? bad) as { slug: string; incentive_code: string }[];
  if (rows.length)
    throw new Error(
      `post-check failed — popup still advertises unredeemable code(s): ${rows
        .map((r) => `${r.slug}/${r.incentive_code}`)
        .join(", ")}`,
    );
  console.log(`\n  COMMITTED — every enabled popup now advertises a code that actually resolves.\n`);
}

async function main() {
  console.log(`\n=== popup discount codes ===\n`);
  await withTxn(run);
}

main().catch((e) => {
  console.error("\n  FAILED —", e instanceof Error ? e.message : e);
  console.error("  nothing was written (single transaction).\n");
  process.exit(1);
});
