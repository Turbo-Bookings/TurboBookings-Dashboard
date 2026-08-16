/**
 * Stripe TEST → LIVE pre-flight: audit, then purge stale test-mode state.
 *
 * Every Stripe ID in Postgres is a test-mode object and becomes invalid the
 * moment a live key is in place. This script reports what would break and,
 * with --commit, clears it.
 *
 *   npm run stripe:preflight                      # audit only (default)
 *   npm run stripe:preflight -- --slug=dtown --commit
 *
 * DRY RUN BY DEFAULT. --commit performs deletes; read the audit first.
 *
 * What --commit does:
 *   1. Deletes test bookings for --slug: bookings (booking_lines + payments +
 *      booking_custom_field_values cascade), plus booking_holds and
 *      payment_methods_on_file for those bookings.
 *   2. Nulls the retainer columns on EVERY location and resets retainer_status
 *      to 'inactive'. Mandatory: ensurePlatformCustomer short-circuits on a
 *      stale cus_ (src/lib/billing/retainer.ts:15) and startRetainer is blocked
 *      by the guard at src/lib/actions/billing.ts:135, so without this the
 *      operator cannot even re-add a card in live mode.
 *
 * What it deliberately does NOT touch: locations (other than the retainer
 * columns), items, customer_types, availability_schedules, availabilities,
 * discount_codes, cancellation policies, branding, assets, tracking config.
 * The catalog survives; only money-shaped test state is cleared.
 *
 * NOTE: authorized holds must be captured or released in the Stripe TEST
 * dashboard BEFORE the key swap — deleting the row here does not release the
 * customer's authorization at Stripe.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  bookingHolds,
  bookings,
  customers,
  getDb,
  locations,
  paymentMethodsOnFile,
  payments,
} from "../src/lib/db";
// The default neon-http client can't do transactions. src/lib/db/txn.ts is
// `server-only` and can't be imported from a CLI, so open the same WebSocket
// pool locally for the atomic purge.
import { Pool } from "@neondatabase/serverless";
import { drizzle as drizzleWs, type NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "../src/lib/db/schema";

type WsDb = NeonDatabase<typeof schema>;
type Tx = Parameters<Parameters<WsDb["transaction"]>[0]>[0];

async function withTxn<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const dbw = drizzleWs(pool, { schema });
  try {
    return await dbw.transaction((tx) => fn(tx));
  } finally {
    await pool.end();
  }
}

const COMMIT = process.argv.includes("--commit");
function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function head(t: string) {
  console.log(`\n=== ${t} ===`);
}

async function main() {
  const db = getDb();
  const slug = arg("slug");

  console.log(`\n${COMMIT ? "COMMIT" : "DRY RUN"} — Stripe live-cutover pre-flight`);
  if (COMMIT && !slug) {
    throw new Error("--commit requires --slug so a purge can never hit every location by accident");
  }

  // ── Audit: what is stale ────────────────────────────────────────────────
  head("LOCATIONS — Stripe state");
  const locs = await db
    .select({
      slug: locations.slug,
      status: locations.status,
      connected: sql<boolean>`${locations.stripeAccountId} is not null`,
      retainerStatus: locations.retainerStatus,
      hasCustomer: sql<boolean>`${locations.stripePlatformCustomerId} is not null`,
      hasSubscription: sql<boolean>`${locations.stripeSubscriptionId} is not null`,
      card: sql<string>`coalesce(${locations.retainerCardBrand} || ' ****' || ${locations.retainerCardLast4}, '—')`,
    })
    .from(locations)
    .orderBy(locations.slug);
  console.table(locs);

  head("AUTHORIZED HOLDS — release or capture in Stripe TEST before the swap");
  const holds = await db
    .select({
      slug: locations.slug,
      bookingNumber: bookings.displayNumber,
      amountCents: bookingHolds.amountCents,
      pi: sql<string>`left(${bookingHolds.stripePaymentIntentId}, 14) || '…'`,
    })
    .from(bookingHolds)
    .innerJoin(bookings, eq(bookings.id, bookingHolds.bookingId))
    .innerJoin(locations, eq(locations.id, bookings.locationId))
    .where(eq(bookingHolds.status, "authorized"));
  console.table(holds.length ? holds : [{ note: "none — clear" }]);

  head("PAYMENTS with a test-mode payment intent (unrefundable after the swap)");
  const pays = await db
    .select({
      slug: locations.slug,
      n: sql<number>`count(*)::int`,
      cents: sql<number>`coalesce(sum(${payments.amountCents}), 0)::int`,
    })
    .from(payments)
    .innerJoin(bookings, eq(bookings.id, payments.bookingId))
    .innerJoin(locations, eq(locations.id, bookings.locationId))
    .where(isNotNull(payments.stripePaymentIntentId))
    .groupBy(locations.slug);
  console.table(pays.length ? pays : [{ note: "none" }]);

  head("BOOKINGS by location / status");
  const bk = await db
    .select({
      slug: locations.slug,
      status: bookings.status,
      n: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .innerJoin(locations, eq(locations.id, bookings.locationId))
    .groupBy(locations.slug, bookings.status)
    .orderBy(locations.slug);
  console.table(bk.length ? bk : [{ note: "none" }]);

  if (!slug) {
    console.log("\nAudit only. Pass --slug=<location> to scope a purge, then --commit to apply.");
    return;
  }

  // ── Scoped purge ────────────────────────────────────────────────────────
  const [loc] = await db.select().from(locations).where(eq(locations.slug, slug)).limit(1);
  if (!loc) throw new Error(`no location with slug "${slug}"`);

  const targets = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.locationId, loc.id));
  const ids = targets.map((t) => t.id);

  // Cards on file hang off the CUSTOMER, not the booking (addedFromBookingId is
  // nullable and set-null on delete), so scope them by the location's customers
  // or the stale test-mode pm_ rows would survive the purge.
  const custRows = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.locationId, loc.id));
  const custIds = custRows.map((c) => c.id);

  head(`PURGE PLAN — ${slug}`);
  if (ids.length === 0) {
    console.log("No bookings to purge.");
  } else {
    const [{ nHolds }] = await db
      .select({ nHolds: sql<number>`count(*)::int` })
      .from(bookingHolds)
      .where(inArray(bookingHolds.bookingId, ids));
    const [{ nCards }] = custIds.length
      ? await db
          .select({ nCards: sql<number>`count(*)::int` })
          .from(paymentMethodsOnFile)
          .where(inArray(paymentMethodsOnFile.customerId, custIds))
      : [{ nCards: 0 }];
    const [{ nPays }] = await db
      .select({ nPays: sql<number>`count(*)::int` })
      .from(payments)
      .where(inArray(payments.bookingId, ids));
    console.table([
      { table: "bookings (+ lines, custom field values cascade)", rows: ids.length },
      { table: "payments", rows: nPays },
      { table: "booking_holds", rows: nHolds },
      { table: "payment_methods_on_file", rows: nCards },
    ]);
  }
  console.log("Retainer columns will be cleared on ALL locations (guards require it).");

  if (!COMMIT) {
    console.log("\nNothing was written. Re-run with --commit to apply.");
    return;
  }

  await withTxn(async (tx) => {
    if (custIds.length) {
      await tx
        .delete(paymentMethodsOnFile)
        .where(inArray(paymentMethodsOnFile.customerId, custIds));
    }
    if (ids.length) {
      // Explicit, ordered deletes — these FKs are RESTRICT, not CASCADE.
      await tx.delete(bookingHolds).where(inArray(bookingHolds.bookingId, ids));
      await tx.delete(payments).where(inArray(payments.bookingId, ids));
      // booking_lines + booking_custom_field_values cascade off bookings.
      await tx.delete(bookings).where(inArray(bookings.id, ids));
    }
    await tx
      .update(locations)
      .set({
        stripePlatformCustomerId: null,
        stripeSubscriptionId: null,
        retainerCardBrand: null,
        retainerCardLast4: null,
        retainerStatus: "inactive",
        updatedAt: new Date(),
      })
      .where(
        and(
          sql`true`,
          // Only rows that actually carry stale state, so updated_at isn't
          // churned on locations that were never configured.
          sql`(${locations.stripePlatformCustomerId} is not null
               or ${locations.stripeSubscriptionId} is not null
               or ${locations.retainerStatus} <> 'inactive')`,
        ),
      );
  });

  console.log(`\nPurged ${ids.length} booking(s) for ${slug} and cleared retainer state.`);
  console.log("Next: swap the Stripe keys, then re-onboard Connect and re-add the retainer card live.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("pre-flight failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
