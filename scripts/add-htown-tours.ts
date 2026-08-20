/**
 * Build out the Houston (htown) catalog: the Night ATV Glow Tour and the
 * Four Seater Buggy Tour.
 *
 * Content is transcribed from the operator's LIVE FareHarbor listings, which
 * the operator named as the source of truth:
 *   glow → fareharbor.com/embeds/book/htownatvrentals/items/728197/
 *   buggy → fareharbor.com/embeds/book/htownatvrentals/items/724658/
 *
 * Done as a script rather than by hand in the UI because each tour is four
 * linked writes (item + per-customer-type pricing + per-customer-type resource
 * requirements), and a half-finished tour is worse than no tour — an item with
 * pricing but no resource requirement is bookable and silently oversells.
 *
 * Idempotent: keyed on item NAME per location, so re-running updates in place
 * rather than creating duplicates.
 *
 *   npm run htown:tours            # dry run, prints the plan
 *   npm run htown:tours -- --commit
 */
import { and, eq } from "drizzle-orm";
import { withTxn, type Tx } from "../src/lib/db/pool";
import {
  customerTypes,
  itemCustomerTypes,
  items,
  locations,
  resourceRequirements,
  resources,
} from "../src/lib/db/schema";

const COMMIT = process.argv.includes("--commit");
const SLUG = "htown";

// The company-wide cancellation paragraph, identical on every FareHarbor item.
const CANCELLATION_NOTES =
  "Customers have the opportunity to rebook, or to receive a full refund or credit, by rebooking or cancelling their booking online with 48 hours notice. Customers will also receive a full refund or credit in the case of operator cancellation due to weather or other unforeseen circumstances. No-shows will be charged the full price.";

// FareHarbor shows byte-identical FAQs on the day tour and the glow tour, and
// the day tour's copy already lives in our DB — so these are the operator's own
// published answers, not a rewrite.
const SHARED_FAQS = [
  {
    q: "What does my $20 online deposit cover?",
    a: "Your $20 per person deposit covers a portion of your ATV Rental. The remaining balance is paid upon arrival, along with your park admission fee of $20 per person to enter the ATV park.",
  },
  {
    q: "What is included with every tour?",
    a: "Every booking includes a one-hour guided tour led by trained staff, DOT-approved helmets, on-site safety training, and free professional action photos; you'll ride across 1,000 acres of off-road terrain including mud holes, forest trails, and beach sections.",
  },
  {
    q: "What should I wear and bring?",
    a: "Closed-toe shoes are recommended but slides, sandals, and Crocs are allowed; sunglasses, sunscreen, and outdoor clothing are recommended. Goggles, ski masks, and ponchos are sold onsite.",
  },
  {
    q: "Can I reschedule?",
    a: "Rescheduling with 24+ hours notice is free. With less than 24 hours notice the $20 reservation deposit per ATV is forfeited; call or text with your reservation name, original date/time, and preferred new date/time.",
  },
  {
    q: "Is there a weight limit?",
    a: "ATVs have a 400 lb weight limit. Up to two riders per ATV.",
  },
  {
    q: "What are the age and ID requirements?",
    a: "Drivers must be 12 or older to operate an ATV. No age limit for passengers. Waiver signers must be 18 or older. No driver’s license required, but a valid ID is held at check-in as collateral (a phone photo of ID is accepted and the phone is held).",
  },
  {
    q: "Is there a security deposit?",
    a: "There is no cash security deposit; a valid ID (or phone with a photo of your ID) is held at check-in as collateral and returned after the tour.",
  },
  {
    q: "What if it rains?",
    a: "Tours run rain or shine; trails may be more fun in the mud. Tours are only rescheduled if lightning is present.",
  },
];

// The buggy reuses the shared FAQ set, restating the two answers that are
// specific to riding an ATV: the deposit is per vehicle rather than per person,
// and the capacity is 4 riders rather than a 400 lb / 2-rider ATV limit. Both
// come from the operator's own published copy (htownatvrentals.org pricing +
// FAQ pages). The age/ID answer is left as-is because no published source says
// who may drive the buggy — see the note at the end of this script.
const BUGGY_FAQS = SHARED_FAQS.map((f) => {
  if (f.q === "What does my $20 online deposit cover?")
    return {
      q: f.q,
      a: "Your $20 deposit covers a portion of your buggy rental. The remaining balance is paid upon arrival, along with your park admission fee of $20 per person to enter the ATV park.",
    };
  if (f.q === "Is there a weight limit?")
    return {
      q: "How many people fit in the buggy?",
      a: "The Four Seater Buggy (a Honda Talon) holds up to 4 riders, including the driver.",
    };
  if (f.q === "What is included with every tour?")
    return {
      q: f.q,
      a: "Every booking includes a one-hour guided tour led by trained staff, DOT-approved helmets, on-site safety training, and free professional action photos; you'll ride across 1,000 acres of off-road terrain including mud holes, forest trails, and beach sections.",
    };
  return f;
});

type TourSpec = {
  name: string;
  descriptionMd: string;
  durationMinutes: number;
  highlights: string[];
  included: string[];
  whatToBring: string[];
  minAge: number | null;
  languages: string[];
  groupSizeLabel: string;
  faqs: { q: string; a: string }[];
  sortOrder: number;
  /** customer type (by singular) → price in cents, and which resource it eats */
  pricing: { singular: string; priceCents: number; resource: string }[];
};

const GLOW: TourSpec = {
  name: "Night ATV Glow Tour",
  // FareHarbor "Details" verbatim, plus the same bold deposit line the day tour
  // carries (also verbatim from FareHarbor).
  descriptionMd:
    "When the sun goes down, the trails come alive. H-Town ATV Rentals' Night Glow Tour is a guided, one-hour after-dark ride across 1,000 acres of off-road terrain — mud holes, forest trails, and open beach — all lit with neon LED strips and glow gear. Guides lead the group, capture free photos and videos, and provide safety training so you can focus on the rush of the ride. The experience turns familiar terrain into an electrified nighttime playground.\r\n\r\n**Reserve today for only $20 per ATV with your remaining balance and park admission fee due upon arrival**",
  durationMinutes: 60,
  highlights: [
    "Neon-lit ATVs and glow gear create a sea of color on the trails",
    "One-of-a-kind after-dark riding experience across 1,000 acres",
    "Free photos and videos captured by guides so you can enjoy the ride",
    "High-energy terrain with mud holes, forest trails, and open beach sections",
  ],
  included: [
    "One-hour guided night tour",
    "Glow accessories",
    "ATV rental",
    "Free photos",
    "DOT certified helmet",
  ],
  // From FareHarbor's "Additional information → What to bring".
  whatToBring: [
    "Clothes you are comfortable getting dirty",
    "Closed-toe shoes (Crocs and slides acceptable)",
  ],
  minAge: 3,
  languages: ["English", "Spanish"],
  // FareHarbor's listing says 30; the operator confirmed 2026-08-20 that the
  // real cap is the same 65 as the day tour, so FareHarbor is the stale one.
  groupSizeLabel: "Up to 65 ATVs",
  faqs: SHARED_FAQS,
  sortOrder: 1,
  pricing: [
    { singular: "Single Rider ATV", priceCents: 10000, resource: "ATV" },
    { singular: "Double Rider ATV", priceCents: 15000, resource: "ATV" },
  ],
};

const BUGGY: TourSpec = {
  name: "Four Seater Buggy Tour",
  // FareHarbor "Details" verbatim. FareHarbor's buggy listing has no
  // included/highlights/FAQ sections, so everything below it is filled from the
  // operator's OWN published copy — htownatvrentals.org and the FareHarbor ATV
  // listings — rather than written fresh. Nothing here is invented.
  descriptionMd:
    "Looking for something fun to do? Roll on in and join the crew with H-Town ATV Rentals to have a great adventure. If you seek the chance to ride and get dirty, you've come to the right place! With every turn and bump is a new adrenaline rush of adventure. Through the mud, the dirt, in the sun, and the rain. You don't want to miss your chance to experience these trails with the best tour guides. NO experience necessary!\r\n\r\n**Reserve today for only $20 with your remaining balance and park admission fee due upon arrival**",
  durationMinutes: 60,
  highlights: [
    "Honda Talon side-by-side — up to 4 riders in one buggy",
    "Everyone rides together instead of each driving their own machine",
    "Same 1,000 acres of mud holes, forest trails, and beach sections",
    "Roll cage and seatbelts — the pick for families with younger kids",
  ],
  included: [
    "One-hour guided tour",
    "Four Seater Buggy rental",
    "DOT certified helmet",
    "On-site safety training",
    "Free photos from guides",
  ],
  whatToBring: [
    "Clothes you are comfortable getting dirty",
    "Closed-toe shoes (Crocs and slides acceptable)",
  ],
  minAge: 3,
  languages: ["English", "Spanish"],
  groupSizeLabel: "1 buggy (fits 4 riders)",
  faqs: BUGGY_FAQS,
  sortOrder: 2,
  pricing: [{ singular: "UTV", priceCents: 35000, resource: "UTV" }],
};

// Resources and customer types the tours above depend on. Created only if
// missing — the ATV resource and the two ATV rider types already exist.
const NEEDED_RESOURCES = [{ name: "UTV", maxConcurrentUses: 1, sortOrder: 1 }];
const NEEDED_CUSTOMER_TYPES = [
  {
    singular: "UTV",
    plural: "UTVs",
    note: "Four Seater Buggy (fits 4 riders)",
    sortOrder: 2,
  },
];

async function upsertTour(tx: Tx, locationId: string, spec: TourSpec) {
  const existing = (
    await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.locationId, locationId), eq(items.name, spec.name)))
      .limit(1)
  )[0];

  const values = {
    locationId,
    name: spec.name,
    descriptionMd: spec.descriptionMd,
    defaultDurationMinutes: spec.durationMinutes,
    bookableOnline: true,
    listingVisible: true,
    capacityMode: "resource_based" as const,
    highlights: spec.highlights,
    included: spec.included,
    whatToBring: spec.whatToBring,
    minAge: spec.minAge,
    languages: spec.languages,
    groupSizeLabel: spec.groupSizeLabel,
    faqs: spec.faqs,
    cancellationNotesMd: CANCELLATION_NOTES,
    sortOrder: spec.sortOrder,
    updatedAt: new Date(),
  };

  let itemId: string;
  if (existing) {
    await tx.update(items).set(values).where(eq(items.id, existing.id));
    itemId = existing.id;
    console.log(`  updated item "${spec.name}"`);
  } else {
    itemId = (await tx.insert(items).values(values).returning({ id: items.id }))[0].id;
    console.log(`  created item "${spec.name}"`);
  }

  // Rebuild the pricing + resource links from scratch. Cheaper to reason about
  // than diffing, and safe because nothing references these rows by id.
  await tx.delete(itemCustomerTypes).where(eq(itemCustomerTypes.itemId, itemId));
  await tx.delete(resourceRequirements).where(eq(resourceRequirements.itemId, itemId));

  for (const [i, p] of spec.pricing.entries()) {
    const ct = (
      await tx
        .select({ id: customerTypes.id })
        .from(customerTypes)
        .where(
          and(
            eq(customerTypes.locationId, locationId),
            eq(customerTypes.singular, p.singular),
          ),
        )
        .limit(1)
    )[0];
    if (!ct) throw new Error(`customer type "${p.singular}" not found`);

    const res = (
      await tx
        .select({ id: resources.id })
        .from(resources)
        .where(
          and(eq(resources.locationId, locationId), eq(resources.name, p.resource)),
        )
        .limit(1)
    )[0];
    if (!res) throw new Error(`resource "${p.resource}" not found`);

    await tx.insert(itemCustomerTypes).values({
      itemId,
      customerTypeId: ct.id,
      priceCents: p.priceCents,
      visibility: "visible",
      minQuantity: 0,
      sortOrder: i,
    });
    // Without this row the tour is bookable against nothing and will oversell.
    await tx.insert(resourceRequirements).values({
      itemId,
      customerTypeId: ct.id,
      resourceId: res.id,
      quantityConsumed: 1,
    });
    console.log(
      `    ${p.singular} — $${(p.priceCents / 100).toFixed(2)}, consumes 1 ${p.resource}`,
    );
  }
}

async function main() {
  await withTxn(async (tx) => {
    const loc = (
      await tx
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.slug, SLUG))
        .limit(1)
    )[0];
    if (!loc) throw new Error(`location "${SLUG}" not found`);

    console.log(`\n=== ${SLUG} catalog ===\n`);

    for (const r of NEEDED_RESOURCES) {
      const found = (
        await tx
          .select({ id: resources.id })
          .from(resources)
          .where(and(eq(resources.locationId, loc.id), eq(resources.name, r.name)))
          .limit(1)
      )[0];
      if (found) {
        console.log(`  resource "${r.name}" already exists`);
      } else {
        await tx.insert(resources).values({ locationId: loc.id, ...r });
        console.log(`  created resource "${r.name}" (capacity ${r.maxConcurrentUses})`);
      }
    }

    for (const c of NEEDED_CUSTOMER_TYPES) {
      const found = (
        await tx
          .select({ id: customerTypes.id })
          .from(customerTypes)
          .where(
            and(
              eq(customerTypes.locationId, loc.id),
              eq(customerTypes.singular, c.singular),
            ),
          )
          .limit(1)
      )[0];
      if (found) {
        console.log(`  customer type "${c.singular}" already exists`);
      } else {
        await tx.insert(customerTypes).values({
          locationId: loc.id,
          ticketColor: "#0a0a0a",
          ...c,
        });
        console.log(`  created customer type "${c.singular}"`);
      }
    }

    for (const spec of [GLOW, BUGGY]) await upsertTour(tx, loc.id, spec);

    if (!COMMIT) {
      console.log("\nDRY RUN — rolling back. Re-run with --commit to apply.\n");
      throw new Error("__rollback__");
    }
    console.log("\nCommitted.\n");
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    const msg = e.cause?.message ?? e.message;
    if (msg === "__rollback__") process.exit(0);
    console.error(msg);
    process.exit(1);
  });
