// Seed the existing locations so the master list has something to render
// before any live intake forms have been filled in. Re-runnable: uses slug
// upsert semantics so running this twice doesn't create duplicates.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { locations, type NewLocation } from "../src/lib/db/schema";

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
  },
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

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
