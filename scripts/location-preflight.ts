/**
 * Is this location actually ready to sell?
 *
 *   npm run location:preflight -- --slug=miami
 *   npm run location:preflight                    # every location
 *
 * READ ONLY. Writes nothing, ever.
 *
 * Every check here exists because something went wrong in a real launch, not
 * because it seemed tidy:
 *
 *   - Houston was flipped live on 2026-08-19 with a connected account that
 *     could not take money. The Payment Element renders an EMPTY BOX when
 *     `charges_enabled` is false — no error, no warning — and checkout was dead
 *     for ~25 minutes before anyone noticed.
 *   - Miami sat at deposit_mode='full' with a $0 amount, which quietly means
 *     "charge the customer the entire tour online" rather than a deposit.
 *   - A venue fee set while every customer type says "riders vary" computes to
 *     $0, so the itemized line silently never appears and looks like a bug.
 *
 * `payouts_enabled` is deliberately NOT a blocker. It routinely lags for days
 * while Stripe verifies a bank account, holds the money in the Stripe balance,
 * and blocks nothing the customer sees.
 */
import { and, eq, gte, sql as raw } from "drizzle-orm";
import {
  availabilities,
  cancellationPolicies,
  customerTypes,
  getDb,
  items,
  locations,
  trackingConfig,
} from "@/lib/db";
import Stripe from "stripe";

// src/lib/stripe/connect.ts is `server-only` and cannot be imported from a CLI,
// so the two flags this script needs are read directly. Same reason
// stripe-live-preflight.ts opens its own database pool.
async function fetchAccountStatus(
  id: string,
): Promise<{ chargesEnabled: boolean; payoutsEnabled: boolean }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const acct = await new Stripe(key).accounts.retrieve(id);
  return {
    chargesEnabled: Boolean(acct.charges_enabled),
    payoutsEnabled: Boolean(acct.payouts_enabled),
  };
}

const argv = process.argv;
const arg = (n: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};

type Level = "BLOCK" | "WARN" | "OK";
type Check = { level: Level; label: string; detail: string };

const usd = (c: number | null | undefined) =>
  `$${((c ?? 0) / 100).toFixed(2)}`;

async function checkLocation(slug: string): Promise<Check[]> {
  const db = getDb();
  const out: Check[] = [];
  const add = (level: Level, label: string, detail: string) =>
    out.push({ level, label, detail });

  const loc = (
    await db.select().from(locations).where(eq(locations.slug, slug)).limit(1)
  )[0];
  if (!loc) return [{ level: "BLOCK", label: "location", detail: "no such slug" }];

  // ---- Can it take money at all? -------------------------------------------
  if (!loc.stripeAccountId) {
    add("BLOCK", "Stripe", "no connected account — checkout will refuse every booking");
  } else {
    try {
      const st = await fetchAccountStatus(loc.stripeAccountId);
      if (!st.chargesEnabled)
        add(
          "BLOCK",
          "Stripe charges",
          `charges_enabled=false on ${loc.stripeAccountId} — the Payment Element will render an empty box`,
        );
      else add("OK", "Stripe charges", `enabled on ${loc.stripeAccountId}`);

      if (!st.payoutsEnabled)
        add(
          "WARN",
          "Stripe payouts",
          "payouts_enabled=false — money is held in the Stripe balance and releases on its own. Not a blocker.",
        );
    } catch (e) {
      add(
        "WARN",
        "Stripe",
        `could not read the account (${e instanceof Error ? e.message : "unknown"}). Needs STRIPE_SECRET_KEY for the same mode the account lives in.`,
      );
    }
  }

  // ---- Money math ----------------------------------------------------------
  const dm = loc.depositMode;
  if (dm === "full") {
    add(
      "WARN",
      "Deposit",
      "deposit_mode='full' — the customer is charged the ENTIRE tour online, not a deposit. Correct only if that is the commercial intent.",
    );
  } else if (
    (dm === "flat" || dm === "per_person" || dm === "per_unit") &&
    !loc.depositAmountCents
  ) {
    add("BLOCK", "Deposit", `deposit_mode='${dm}' with no amount set — every booking would take $0 online`);
  } else if (dm === "percent" && !loc.depositPercentBps) {
    add("BLOCK", "Deposit", "deposit_mode='percent' with no percentage set");
  } else {
    add("OK", "Deposit", `${dm} ${usd(loc.depositAmountCents)}`);
  }

  if (!loc.timezone)
    add("BLOCK", "Timezone", "unset — every tour time would render in the server's zone");

  // ---- Venue fee coherence -------------------------------------------------
  if (loc.venueFeePerPersonCents > 0 && loc.venueFeeItemized) {
    const types = await db
      .select({ persons: customerTypes.personsPerUnit })
      .from(customerTypes)
      .where(and(eq(customerTypes.locationId, loc.id), eq(customerTypes.archived, false)));
    if (types.length > 0 && types.every((t) => t.persons === 0))
      add(
        "WARN",
        "Venue fee",
        `${usd(loc.venueFeePerPersonCents)}/person is set to show as a line, but every customer type says "riders vary" — it will compute to $0 and the line will never appear`,
      );
    else add("OK", "Venue fee", `${usd(loc.venueFeePerPersonCents)}/person, itemized`);
  } else if (loc.venueFeePerPersonCents > 0) {
    add("OK", "Venue fee", `${usd(loc.venueFeePerPersonCents)}/person, explained by a notice`);
  }

  // ---- Is there anything to sell? -----------------------------------------
  const sellable = await db
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.locationId, loc.id), eq(items.bookableOnline, true)));
  if (sellable.length === 0) {
    add("BLOCK", "Catalog", "no tours marked bookable online");
  } else {
    const future = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(availabilities)
      .where(
        and(
          raw`${availabilities.itemId} IN (SELECT id FROM items WHERE location_id = ${loc.id})`,
          gte(availabilities.startsAt, new Date()),
        ),
      );
    const n = future[0]?.n ?? 0;
    if (n === 0)
      add("BLOCK", "Availability", `${sellable.length} tour(s) but no future times — nothing is bookable`);
    else add("OK", "Catalog", `${sellable.length} tour(s), ${n} future times`);
  }

  // ---- Things that cost conversion or trust, but don't break checkout ------
  if (!loc.cancellationPolicyId) {
    const any = await db
      .select({ id: cancellationPolicies.id })
      .from(cancellationPolicies)
      .where(eq(cancellationPolicies.locationId, loc.id))
      .limit(1);
    add(
      any.length ? "WARN" : "WARN",
      "Cancellation policy",
      "no default policy on the location — the checkout shows no refund terms",
    );
  }
  if (!loc.googleRatingTenths || !loc.googleReviewCount)
    add("WARN", "Social proof", "no Google rating/review count — the booking flow renders without it");
  if (!loc.contactSupportEmail)
    add("WARN", "Support email", "unset — customers have no reply-to for problems");

  const tc = (
    await db.select().from(trackingConfig).where(eq(trackingConfig.locationId, loc.id)).limit(1)
  )[0];
  if (!tc || (!tc.metaPixelId && !tc.ga4MeasurementId))
    add("WARN", "Tracking", "no pixel and no GA4 stream — ad spend will not attribute");

  if (!loc.retainerCents)
    add("WARN", "Retainer", "monthly retainer not configured — the location is not being billed");

  return out;
}

async function main() {
  const only = arg("slug");
  const db = getDb();
  const rows = await db
    .select({ slug: locations.slug, status: locations.status })
    .from(locations)
    .orderBy(locations.slug);
  const targets = only ? rows.filter((r) => r.slug === only) : rows;
  if (targets.length === 0) {
    console.error(`No location matches --slug=${only}`);
    process.exit(1);
  }

  let blocks = 0;
  for (const t of targets) {
    const checks = await checkLocation(t.slug);
    const b = checks.filter((c) => c.level === "BLOCK");
    const w = checks.filter((c) => c.level === "WARN");
    blocks += b.length;
    const verdict = b.length ? "NOT READY" : w.length ? "READY (with warnings)" : "READY";
    console.log(`\n━━ ${t.slug}  [${t.status}]  →  ${verdict}`);
    for (const c of checks) {
      if (c.level === "OK") continue;
      console.log(`   ${c.level === "BLOCK" ? "✖" : "•"} ${c.label}: ${c.detail}`);
    }
    for (const c of checks.filter((c) => c.level === "OK"))
      console.log(`   ✓ ${c.label}: ${c.detail}`);
  }

  console.log(
    `\nThe two checks a script cannot do — do them by hand before flipping the site over:\n` +
      `  1. Load the real checkout and confirm a CARD FORM RENDERS with the right amount.\n` +
      `  2. Take one real booking end to end, then refund it.\n`,
  );
  process.exit(blocks > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
