/**
 * One-off: create Dallas's Night ATV Glow Tour.
 *
 *   npx tsx scripts/create-dtown-glow-tour.ts            # dry run
 *   npx tsx scripts/create-dtown-glow-tour.ts --commit
 *
 * Mirrors Houston's glow tour for the EXPERIENCE (framing, hours, photos) and Dallas's own ATV tour
 * for the FACTS (pricing, fleet size, what the customer pays). Houston's copy is full of
 * Houston-specific claims — 1,000 acres, an open beach, a $20 park admission fee, up to 65 ATVs —
 * none of which are true in Dallas, whose venue fee is 0. Copying it verbatim would have put false
 * statements in front of Dallas customers.
 *
 * ## Capacity: 1 ATV + 1 Glow Kit
 *
 * Dallas starts with 10 glow-equipped machines out of a 27-ATV fleet (3 out of service). Modelling
 * that as a separate 10-unit "Glow ATVs" pool would let the day tour sell 24 and the glow tour sell
 * 10 from the same 24 machines — the overbooking bug fixed in bookingsystem 79bf5f4, reintroduced
 * as configuration.
 *
 * Instead the glow tour requires TWO resources: an ATV (shared with the day tour) and a Glow Kit
 * (glow only, 10 units). `resourceRemaining()` already takes the minimum across pools, so capacity
 * is min(ATVs free, kits free) with no code change — and the ATV pool stays honest.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const COMMIT = process.argv.includes("--commit");

const DTOWN_ATV_ITEM = "a41eef1e-4617-409d-a622-5835c656ed73";
const HTOWN_GLOW_ITEM = "b03464db-0e07-4f8e-b119-417ab6c8ae06";
const GLOW_KIT_UNITS = 10;

function dbUrl(): string {
  const raw = readFileSync(".env.plan.local", "utf8");
  const m =
    raw.match(/^DATABASE_URL_UNPOOLED="?([^"\n]+)"?/m) ??
    raw.match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (!m) throw new Error("No DATABASE_URL — run `vercel env pull .env.plan.local --environment=production`");
  return m[1];
}

const DESCRIPTION = `When the sun goes down, the trails come alive. The D-Town Night Glow Tour is a guided, one-hour after-dark ride across our off-road park — mud holes, forest trails, and open straightaways — with every ATV wrapped in neon LED strips and glow gear. Guides lead the group, capture free photos and videos, and run safety training before you ride, so you can focus on the rush.

Only **10 glow-equipped ATVs** run each night, so these tours sell out quickly.

**Reserve today for only $20 per ATV, with the remaining balance due in cash at check-in.**`;

const HIGHLIGHTS = [
  "Neon-lit ATVs and glow gear turn the trails into a sea of color",
  "One-of-a-kind after-dark ride — mud holes, forest trails and open straightaways",
  "Free photos and videos captured by your guides so you can enjoy the ride",
  "Only 10 glow ATVs per night, in small guided groups",
];

const INCLUDED = [
  "One-hour guided night tour",
  "Glow accessories",
  "ATV rental for the full tour",
  "Pre-ride safety briefing & guided instruction",
  "Professional trail guide",
  "Helmets",
  "Photos from tour guides",
];

const WHAT_TO_BRING = [
  "Closed-toe shoes",
  "A valid government-issued ID",
  "Clothes you don't mind getting dirty",
  "A jacket — it cools down after dark",
];

const FAQS = [
  {
    q: "What does my $20 online deposit cover?",
    a: "Your $20 per-ATV deposit reserves your machine and counts toward the tour price. The remaining balance is paid in cash at check-in — $100 remaining on a Single Rider ATV, $170 on a Double Rider.",
  },
  {
    q: "What is included with every tour?",
    a: "A one-hour guided night ride led by trained staff, glow accessories and neon-lit ATVs, DOT-approved helmets, on-site safety training, and free professional action photos.",
  },
  {
    q: "Why do glow tours sell out faster?",
    a: "We run 10 glow-equipped ATVs per night. Once those are booked the tour is full, even if day tours still have availability.",
  },
  {
    q: "What should I wear and bring?",
    a: "Closed-toe shoes and clothes you don't mind getting dirty. Bring a jacket — it cools down after dark. Sunglasses aren't needed at night, but a face mask helps in the dust.",
  },
  {
    q: "Can I reschedule?",
    a: "Rescheduling with 24+ hours notice is free. With less than 24 hours notice the $20 reservation deposit per ATV is forfeited. Call or text with your reservation name, original date and time, and preferred new date and time.",
  },
  { q: "Is there a weight limit?", a: "ATVs have a 400 lb weight limit. Up to two riders per ATV." },
  {
    q: "What are the age and ID requirements?",
    a: "Drivers must be 12 or older to operate an ATV. No age limit for passengers. Waiver signers must be 18 or older. No driver's license required, but a valid ID is held at check-in as collateral.",
  },
  {
    q: "What if it rains?",
    a: "Tours run rain or shine; the trails are often more fun in the mud. Tours are only rescheduled if lightning is present.",
  },
];

async function main() {
  const sql = neon(dbUrl());
  const log = (s: string) => console.log(s);

  const loc = (await sql.query(`SELECT id, timezone FROM locations WHERE slug='dtown'`))[0] as
    | { id: string; timezone: string }
    | undefined;
  if (!loc) throw new Error("dtown location not found");

  const existing = (await sql.query(
    `SELECT id FROM items WHERE location_id=$1 AND name ILIKE '%glow%'`,
    [loc.id],
  )) as { id: string }[];
  if (existing.length) {
    log(`Dallas already has a glow tour (${existing[0].id}). Nothing to do.`);
    return;
  }

  // Pricing + rider types come from Dallas's own ATV tour — same machines, same rates.
  const pricing = (await sql.query(
    `SELECT ict.customer_type_id, ct.singular, ict.price_cents, ict.visibility,
            ict.min_quantity, ict.max_quantity, ict.sort_order
     FROM item_customer_types ict JOIN customer_types ct ON ct.id=ict.customer_type_id
     WHERE ict.item_id=$1 ORDER BY ict.sort_order`,
    [DTOWN_ATV_ITEM],
  )) as {
    customer_type_id: string;
    singular: string;
    price_cents: number;
    visibility: string;
    min_quantity: number;
    max_quantity: number | null;
    sort_order: number;
  }[];

  const atvResource = (await sql.query(
    `SELECT id, max_concurrent_uses, out_of_service_count FROM resources
     WHERE location_id=$1 AND name='ATV'`,
    [loc.id],
  ))[0] as { id: string; max_concurrent_uses: number; out_of_service_count: number };

  const photos = (
    (await sql.query(`SELECT photo_urls FROM items WHERE id=$1`, [HTOWN_GLOW_ITEM]))[0] as {
      photo_urls: string[];
    }
  ).photo_urls;

  const sortOrder =
    Number(
      (
        (await sql.query(
          `SELECT COALESCE(MAX(sort_order),-1)+1 AS n FROM items WHERE location_id=$1`,
          [loc.id],
        ))[0] as { n: number }
      ).n,
    ) || 1;

  log(`${COMMIT ? "COMMIT" : "DRY RUN"} — Dallas Night ATV Glow Tour`);
  log(`  timezone       : ${loc.timezone}`);
  log(`  rider types    : ${pricing.map((p) => `${p.singular} $${p.price_cents / 100}`).join(", ")}`);
  log(`  ATV pool       : ${atvResource.max_concurrent_uses} max − ${atvResource.out_of_service_count} oos = ${atvResource.max_concurrent_uses - atvResource.out_of_service_count} usable (SHARED with the day tour)`);
  log(`  Glow Kit pool  : ${GLOW_KIT_UNITS} (new resource, glow tour only)`);
  log(`  effective cap  : min(ATVs free, ${GLOW_KIT_UNITS}) per slot`);
  log(`  hours          : 20:00 21:00 22:00 23:00 daily, 60 min (mirrors Houston)`);
  log(`  photos         : ${photos.length} reused from Houston's glow tour`);
  log(`  sort_order     : ${sortOrder}`);

  if (!COMMIT) {
    log("\nNothing written. Re-run with --commit.");
    return;
  }

  const itemId = randomUUID();
  const kitId = randomUUID();

  await sql.query(
    `INSERT INTO resources (id, location_id, name, max_concurrent_uses, out_of_service_count, sort_order)
     VALUES ($1,$2,$3,$4,0,$5)`,
    [kitId, loc.id, "Glow Kit", GLOW_KIT_UNITS, 1],
  );
  log(`  + resource "Glow Kit" ×${GLOW_KIT_UNITS}`);

  await sql.query(
    `INSERT INTO items (id, location_id, name, description_md, photo_urls, default_duration_minutes,
                        bookable_online, listing_visible, sort_order, capacity_mode,
                        highlights, included, what_to_bring, min_age, languages,
                        group_size_label, faqs, cancellation_notes_md)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,true,true,$7,'resource_based',
             $8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13,$14::jsonb,$15)`,
    [
      itemId,
      loc.id,
      "Night ATV Glow Tour",
      DESCRIPTION,
      JSON.stringify(photos),
      60,
      sortOrder,
      JSON.stringify(HIGHLIGHTS),
      JSON.stringify(INCLUDED),
      JSON.stringify(WHAT_TO_BRING),
      12,
      JSON.stringify(["English", "Spanish"]),
      "Up to 10 glow ATVs per tour",
      JSON.stringify(FAQS),
      "Rescheduling with 24+ hours notice is free. With less than 24 hours notice the $20 reservation deposit per ATV is forfeited. No-shows forfeit the deposit.",
    ],
  );
  log(`  + item ${itemId}`);

  for (const p of pricing) {
    await sql.query(
      `INSERT INTO item_customer_types (item_id, customer_type_id, price_cents, visibility,
                                        min_quantity, max_quantity, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [itemId, p.customer_type_id, p.price_cents, p.visibility, p.min_quantity, p.max_quantity, p.sort_order],
    );
    // Both resources, per rider type. The ATV keeps the glow tour inside the shared fleet; the kit
    // caps it at 10.
    for (const resourceId of [atvResource.id, kitId]) {
      await sql.query(
        `INSERT INTO resource_requirements (item_id, customer_type_id, resource_id, quantity_consumed)
         VALUES ($1,$2,$3,1)`,
        [itemId, p.customer_type_id, resourceId],
      );
    }
    log(`  + ${p.singular} $${p.price_cents / 100} → 1 ATV + 1 Glow Kit`);
  }

  await sql.query(
    `INSERT INTO availability_schedules (item_id, rrule_text, start_times_local, duration_minutes,
                                         capacity_per_slot, default_online_booking_status,
                                         materialize_days_ahead, active)
     VALUES ($1,$2,$3::jsonb,60,NULL,'auto',540,true)`,
    [
      itemId,
      "DTSTART:20260822T000000Z\nRRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA",
      JSON.stringify(["20:00", "21:00", "22:00", "23:00"]),
    ],
  );
  log(`  + schedule 20:00/21:00/22:00/23:00 daily`);

  log(`\nCreated. Run the materializer to generate slots:`);
  log(`  curl -X GET "https://dashboard.turbobookings.net/api/cron/materialize-availability" -H "Authorization: Bearer $CRON_SECRET"`);
  log(`  …or wait for the 08:00 UTC cron.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
