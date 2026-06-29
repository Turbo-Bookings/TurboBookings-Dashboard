// One-off: seed mock bookings on dtown's slots for TODAY so the manifest can be
// reviewed with realistic density. All customers use @manifestmock.test emails
// so they can be bulk-deleted later. Run: npm run db:seed-manifest-mock
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  availabilities,
  bookingLines,
  bookings,
  customerTypes,
  customers,
  getDb,
  itemCustomerTypes,
  items,
  locations,
} from "@/lib/db";

const NAMES = [
  "Marcus Reyes", "Tasha Bell", "Diego Romero", "Priya Patel", "Jordan Lee",
  "Sofia Marin", "Caleb Nguyen", "Aaliyah Brooks", "Ethan Cole", "Lena Vargas",
  "Noah Carter", "Maya Flores", "Ivan Petrov", "Grace Kim", "Omar Haddad",
  "Bella Russo", "Tyler Quinn", "Nadia Osei", "Felix Wong", "Cara Donnelly",
];
const CHECK = ["not_yet", "checked_in", "no_show"] as const;

async function main() {
  const db = getDb();
  const loc = (await db.select().from(locations).where(eq(locations.slug, "dtown")).limit(1))[0];
  if (!loc) throw new Error("dtown not found");
  const tz = loc.timezone ?? "America/Chicago";
  const day = DateTime.now().setZone(tz).startOf("day");
  const start = day.toUTC().toJSDate();
  const end = day.plus({ days: 1 }).toUTC().toJSDate();

  const slots = await db
    .select({ a: availabilities, itemId: availabilities.itemId, itemName: items.name })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .where(and(eq(items.locationId, loc.id), gte(availabilities.startsAt, start), lt(availabilities.startsAt, end)))
    .orderBy(asc(availabilities.startsAt));
  if (slots.length === 0) throw new Error("No dtown slots today — generate a schedule first.");

  // Pricing per item.
  const itemIds = [...new Set(slots.map((s) => s.itemId))];
  const priceRows = await db
    .select({ itemId: itemCustomerTypes.itemId, ctId: itemCustomerTypes.customerTypeId, price: itemCustomerTypes.priceCents, name: customerTypes.singular })
    .from(itemCustomerTypes)
    .innerJoin(customerTypes, eq(itemCustomerTypes.customerTypeId, customerTypes.id))
    .where(inArray(itemCustomerTypes.itemId, itemIds));
  const pricesByItem = new Map<string, { ctId: string; price: number; name: string }[]>();
  for (const r of priceRows) {
    const list = pricesByItem.get(r.itemId) ?? [];
    list.push({ ctId: r.ctId, price: r.price, name: r.name });
    pricesByItem.set(r.itemId, list);
  }

  // Current max display number.
  const existing = await db.select({ d: bookings.displayNumber }).from(bookings).where(eq(bookings.locationId, loc.id));
  let nextNum = 0;
  for (const r of existing) {
    const n = parseInt(r.d, 10);
    if (Number.isFinite(n) && n > nextNum) nextNum = n;
  }

  let nameIdx = 0;
  let created = 0;
  const useSlots = slots.slice(0, 8); // up to 8 slots today

  for (const slot of useSlots) {
    const prices = pricesByItem.get(slot.itemId);
    if (!prices || prices.length === 0) continue;
    const nBookings = 1 + (created % 3); // 1–3 per slot
    for (let b = 0; b < nBookings; b++) {
      const fullName = NAMES[nameIdx % NAMES.length];
      nameIdx++;
      const [firstName, ...rest] = fullName.split(" ");
      const emailLower = `${fullName.toLowerCase().replace(/[^a-z]/g, ".")}.${nameIdx}@manifestmock.test`;

      const cust = (
        await db
          .insert(customers)
          .values({ locationId: loc.id, emailLower, firstName, lastName: rest.join(" ") || null, phoneE164: `+1305555${String(1000 + nameIdx).slice(-4)}`, firstSeenAt: new Date() })
          .onConflictDoUpdate({ target: [customers.locationId, customers.emailLower], set: { updatedAt: new Date() } })
          .returning()
      )[0];

      // 1–2 rider-type lines, qty 1–3 each.
      const lineDefs = prices.slice(0, 1 + (b % 2)).map((p) => ({ ...p, q: 1 + ((nameIdx + b) % 3) }));
      const subtotal = lineDefs.reduce((s, l) => s + l.q * l.price, 0);
      const taxCents = loc.taxMode === "passed_to_customer" ? Math.round(subtotal * (loc.taxRateBps / 10000)) : 0;
      const total = subtotal + taxCents; // walk-in mock: no platform fee
      nextNum++;
      const displayNumber = String(nextNum).padStart(4, "0");
      const rollup = CHECK[(nameIdx + b) % CHECK.length];

      const booking = (
        await db
          .insert(bookings)
          .values({
            locationId: loc.id,
            itemId: slot.itemId,
            availabilityId: slot.a.id,
            customerId: cust.id,
            displayNumber,
            source: "direct",
            status: "active",
            subtotalCents: subtotal,
            taxCents,
            platformFeeCents: 0,
            totalCents: total,
            depositPaidCents: 0,
            balanceDueCents: total,
            notes: b === 0 ? "[MOCK] VIP — bring extra helmet" : null,
          })
          .returning()
      )[0];

      await db.insert(bookingLines).values(
        lineDefs.map((l, i) => ({
          bookingId: booking.id,
          customerTypeId: l.ctId,
          quantity: l.q,
          unitPriceCents: l.price,
          checkedInUnits: rollup === "checked_in" ? l.q : 0,
          noShowUnits: rollup === "no_show" ? l.q : 0,
          checkInStatus: rollup,
          checkedInAt: rollup === "checked_in" ? new Date() : null,
          sortOrder: i,
        })),
      );
      created++;
    }
  }

  console.log(`Seeded ${created} mock bookings across ${useSlots.length} dtown slots for ${day.toFormat("yyyy-LL-dd")}.`);
}

main().catch((e) => {
  console.error("ERR:", e?.message ?? e);
  process.exit(1);
});
