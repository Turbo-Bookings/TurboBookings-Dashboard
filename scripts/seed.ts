// Seed the existing locations so the master list has something to render
// before any live intake forms have been filled in. Re-runnable: uses slug
// upsert semantics so running this twice doesn't create duplicates.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq, sql } from "drizzle-orm";
import {
  cancellationPolicies,
  cancellationPolicyRules,
  customerTypes,
  items,
  locations,
  type NewLocation,
} from "../src/lib/db/schema";

const seed: NewLocation[] = [
  {
    slug: "miami",
    status: "launched",
    brandDisplayName: "Takeovers",
    brandLocationLabel: "Miami",
    brandLegalName: "Takeovers Miami ATV Rentals",
    contactAddress: "12790 SW 157th Ave, Miami, FL 33196",
    contactPhone: "(786) 547-1047",
    contactPhoneE164: "+17865471047",
    contactSupportEmail: "support@takeoversrentals.com",
    domainApex: "takeoversmiamiatvrentals.com",
    domainCanonical: "https://www.takeoversmiamiatvrentals.com",
    domainLocales: ["en", "es"],
    domainDefaultLocale: "en",
    timezone: "America/New_York",
    // FL state sales tax = 7%
    taxRateBps: 700,
    fareharborShortname: "takeoversmiamiatvrentals",
    fareharborDefaultFlowId: "1612171",
    fareharborTourCatalog: [
      { key: "atv45", displayName: "45-Minute ATV Tour", fareharborItemId: "722558", price: 110, durationMinutes: 45 },
      { key: "atv1h", displayName: "1-Hour ATV Tour", fareharborItemId: "722536", price: 130, durationMinutes: 60 },
      { key: "atv2h", displayName: "2-Hour ATV Tour", fareharborItemId: "722547", price: 170, durationMinutes: 120 },
      { key: "utv2seat", displayName: "2-Seat UTV Tour", fareharborItemId: "722564", price: 0, durationMinutes: 60 },
      { key: "utv4seat", displayName: "4-Seat UTV Tour", fareharborItemId: "722566", price: 0, durationMinutes: 60 },
    ],
    marketingFromName: "Matt from Takeovers",
    marketingSendingSubdomain: "send.takeoversmiamiatvrentals.com",
    marketingReplyToEmail: "matt@takeoversmiamiatvrentals.com",
    socialsInstagram: "https://www.instagram.com/takeoversrentals/",
    socialsTiktok: "https://www.tiktok.com/@takeoversatvrentals",
    socialsFacebook: "https://www.facebook.com/takeoversrentals/",
    githubRepoUrl: "https://github.com/Turbo-Bookings/takeovers-site",
  },
  {
    slug: "htown",
    status: "launched",
    brandDisplayName: "HTown ATV Rentals",
    brandLocationLabel: "Houston",
    brandLegalName: "HTown ATV Rentals LLC",
    contactAddress: "807 Highway 90, Crosby, TX 77532",
    contactPhone: "(832) 228-5929",
    contactPhoneE164: "+18322285929",
    contactSupportEmail: "support@htownatvrentals.org",
    domainApex: "htownatvrentals.org",
    domainCanonical: "https://www.htownatvrentals.org",
    domainLocales: ["en"],
    domainDefaultLocale: "en",
    timezone: "America/Chicago",
    fareharborShortname: "htownatvrentals",
    fareharborDefaultFlowId: "1618818",
    fareharborTourCatalog: [
      { key: "atv1h", displayName: "1-Hour ATV Tour", fareharborItemId: "724641", price: 0, durationMinutes: 60 },
      { key: "utv4seat", displayName: "4-Seat UTV Tour", fareharborItemId: "724658", price: 0, durationMinutes: 60 },
      { key: "glowAtv", displayName: "Glow ATV Tour", fareharborItemId: "728197", price: 0, durationMinutes: 60, flowOverride: "no" },
    ],
    marketingFromName: "Matt from H-Town",
    marketingSendingSubdomain: "send.htownatvrentals.org",
    marketingReplyToEmail: "support@htownatvrentals.org",
    githubRepoUrl: "https://github.com/Turbo-Bookings/htown-atv-rentals-site",
  },
  {
    slug: "dtown",
    status: "draft",
    brandLocationLabel: "Dallas",
    brandLegalName: "DTown ATV Rentals LLC",
    domainApex: "dtownatvrentals.com",
    domainCanonical: "https://www.dtownatvrentals.com",
    domainLocales: ["en"],
    domainDefaultLocale: "en",
    timezone: "America/Chicago",
  },
];

// Minimal catalog for the dtown (Dallas) draft location so the booking-system
// build has tours + customer types to attach schedules to. Idempotent by
// (locationId, name) since neither table has a unique name constraint.
type SeedCustomerType = { singular: string; plural: string };
type SeedItem = { name: string; defaultDurationMinutes: number };

const DTOWN_CUSTOMER_TYPES: SeedCustomerType[] = [
  { singular: "Single Rider ATV", plural: "Single Rider ATVs" },
  { singular: "Double Rider ATV", plural: "Double Rider ATVs" },
];

const DTOWN_ITEMS: SeedItem[] = [
  { name: "1-Hour ATV Tour", defaultDurationMinutes: 60 },
  { name: "2-Hour ATV Tour", defaultDurationMinutes: 120 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = drizzle(neon(url));

  for (const row of seed) {
    await db
      .insert(locations)
      .values(row)
      .onConflictDoUpdate({
        target: locations.slug,
        // Re-applying the seed should refresh static fields but leave
        // timestamps alone. updatedAt is bumped explicitly.
        set: { ...row, updatedAt: sql`now()` },
      });
    console.log(`✓ upserted ${row.slug} (${row.status})`);
  }

  // Default cancellation policy per location — Miami's matches what the
  // FareHarbor crawl revealed (24-hour cutoff, 100% refund if before).
  // HTown + DTown start with the same defaults; operator adjusts via UI.
  await seedDefaultCancellationPolicies(db);

  // Test catalog for dtown so the booking-system build has data to work with.
  await seedDtownCatalog(db);

  console.log("\nDone.");
}

async function seedDtownCatalog(
  db: ReturnType<typeof drizzle>,
): Promise<void> {
  const dtownRows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, "dtown"))
    .limit(1);
  const dtown = dtownRows[0];
  if (!dtown) return;

  for (let i = 0; i < DTOWN_CUSTOMER_TYPES.length; i++) {
    const ct = DTOWN_CUSTOMER_TYPES[i];
    const existing = await db
      .select({ id: customerTypes.id })
      .from(customerTypes)
      .where(
        and(
          eq(customerTypes.locationId, dtown.id),
          eq(customerTypes.singular, ct.singular),
        ),
      )
      .limit(1);
    if (existing[0]) continue;
    await db.insert(customerTypes).values({
      locationId: dtown.id,
      singular: ct.singular,
      plural: ct.plural,
      sortOrder: i,
    });
    console.log(`  ✓ dtown customer type "${ct.singular}"`);
  }

  for (let i = 0; i < DTOWN_ITEMS.length; i++) {
    const it = DTOWN_ITEMS[i];
    const existing = await db
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.locationId, dtown.id), eq(items.name, it.name)))
      .limit(1);
    if (existing[0]) continue;
    await db.insert(items).values({
      locationId: dtown.id,
      name: it.name,
      defaultDurationMinutes: it.defaultDurationMinutes,
      sortOrder: i,
    });
    console.log(`  ✓ dtown tour "${it.name}"`);
  }
}

async function seedDefaultCancellationPolicies(
  db: ReturnType<typeof drizzle>,
): Promise<void> {
  const allLocs = await db.select().from(locations);
  for (const loc of allLocs) {
    // Idempotent — only insert if no default policy exists yet for this
    // location.
    const existing = await db
      .select({ id: cancellationPolicies.id })
      .from(cancellationPolicies)
      .where(
        and(
          eq(cancellationPolicies.locationId, loc.id),
          eq(cancellationPolicies.isDefault, true),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    const inserted = await db
      .insert(cancellationPolicies)
      .values({
        locationId: loc.id,
        name: "Default",
        isDefault: true,
        gracePeriodMinutes: 15, // 15-min window after booking to cancel for any reason
      })
      .returning({ id: cancellationPolicies.id });

    // One rule: cancel ≥24 hours before start → 100% refund. Anything
    // closer = 0% (the implicit "no rule matched" fallback).
    await db.insert(cancellationPolicyRules).values({
      policyId: inserted[0].id,
      hoursBeforeStart: 24,
      refundPctBps: 10000,
    });

    // Set the location's default cancellation policy FK
    await db
      .update(locations)
      .set({ cancellationPolicyId: inserted[0].id, updatedAt: sql`now()` })
      .where(eq(locations.id, loc.id));

    console.log(
      `  ✓ default cancellation policy for ${loc.slug} (24hr cutoff, 100% refund)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
