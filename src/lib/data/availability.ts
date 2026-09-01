import "server-only";
import { and, asc, count, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  bestTypeRemaining,
  cartFits,
  fixedRemaining,
  remainingByType,
  slotRemaining,
  type Cart,
} from "@/lib/booking/capacity";
import { poolsAndRequirementsForItem, withUsage } from "@/lib/booking/pools";
import { overlappingResourceUsage } from "@/lib/availability/resourceUsage";
import {
  availabilities,
  availabilitySchedules,
  bookingLines,
  bookings,
  getDb,
  items,
} from "@/lib/db";

// Generated bookable slots (concrete availabilities). Read side for the
// operator's "generated slots" view; the customer flow reads this later too.

export type UpcomingSlot = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  onlineBookingStatus: "on" | "off" | "auto";
  capacityOverride: number | null;
  itemName: string;
  itemCapacityMode: "resource_based" | "fixed";
  scheduleCapacityPerSlot: number | null;
};

export async function listUpcomingAvailabilities(
  locationId: string,
  days = 14,
): Promise<UpcomingSlot[]> {
  const db = getDb();
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  return db
    .select({
      id: availabilities.id,
      startsAt: availabilities.startsAt,
      endsAt: availabilities.endsAt,
      onlineBookingStatus: availabilities.onlineBookingStatus,
      capacityOverride: availabilities.capacityOverride,
      itemName: items.name,
      itemCapacityMode: items.capacityMode,
      scheduleCapacityPerSlot: availabilitySchedules.capacityPerSlot,
    })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .leftJoin(
      availabilitySchedules,
      eq(availabilities.scheduleId, availabilitySchedules.id),
    )
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, now),
        lt(availabilities.startsAt, until),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
}

// Count of upcoming (future) generated slots for a location.
export async function countUpcomingAvailabilities(
  locationId: string,
): Promise<number> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({ c: count() })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .where(and(eq(items.locationId, locationId), gte(availabilities.startsAt, now)));
  return rows[0]?.c ?? 0;
}

// Slots whose LOCAL calendar date (in the location's timezone) equals dateKey.
export async function listSlotsForDay(
  locationId: string,
  dateKey: string,
  tz: string | null,
): Promise<UpcomingSlot[]> {
  const db = getDb();
  const zone = tz ?? "utc";
  const dayStart = DateTime.fromISO(dateKey, { zone }).startOf("day");
  if (!dayStart.isValid) return [];
  const start = dayStart.toUTC().toJSDate();
  const end = dayStart.plus({ days: 1 }).toUTC().toJSDate();
  return db
    .select({
      id: availabilities.id,
      startsAt: availabilities.startsAt,
      endsAt: availabilities.endsAt,
      onlineBookingStatus: availabilities.onlineBookingStatus,
      capacityOverride: availabilities.capacityOverride,
      itemName: items.name,
      itemCapacityMode: items.capacityMode,
      scheduleCapacityPerSlot: availabilitySchedules.capacityPerSlot,
    })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .leftJoin(
      availabilitySchedules,
      eq(availabilities.scheduleId, availabilitySchedules.id),
    )
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, start),
        lt(availabilities.startsAt, end),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
}

// Map of local "YYYY-MM-DD" -> slot count for a calendar month.
export async function slotCountsForMonth(
  locationId: string,
  year: number,
  month: number,
  tz: string | null,
): Promise<Map<string, number>> {
  const db = getDb();
  const zone = tz ?? "utc";
  const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone });
  if (!monthStart.isValid) return new Map();
  const start = monthStart.toUTC().toJSDate();
  const end = monthStart.plus({ months: 1 }).toUTC().toJSDate();
  const rows = await db
    .select({ startsAt: availabilities.startsAt })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, start),
        lt(availabilities.startsAt, end),
      ),
    );
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = DateTime.fromJSDate(r.startsAt).setZone(zone).toFormat("yyyy-LL-dd");
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

// Tenancy-checked single slot fetch.
export async function getSlot(
  slotId: string,
  locationId: string,
): Promise<{ id: string; itemId: string; startsAt: Date; endsAt: Date } | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: availabilities.id,
      itemId: availabilities.itemId,
      startsAt: availabilities.startsAt,
      endsAt: availabilities.endsAt,
    })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .where(and(eq(availabilities.id, slotId), eq(items.locationId, locationId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Open slots for a tour — the ones a rep or the reschedule picker can move a booking into.
 *
 * Lives here rather than in `actions/manualBooking.ts` because it is a QUERY, not an action. Every
 * export of a `"use server"` file is a POST endpoint, so keeping a plain data lookup in one published
 * it as a callable surface that took a raw location id and checked nothing — for no benefit, since
 * both of its callers are already-guarded actions in other files.
 */
export type OpenSlot = {
  id: string;
  startsAt: Date;
  /** Total vehicles sellable across every option. NOT a booking-fits test — see `fits`. */
  remaining: number;
  /** Standalone "N left" per option. Never sum these: options sharing a pool double-count. */
  perType: { customerTypeId: string; remaining: number }[];
  /** Whether `cart` (or, with no cart, anything at all) actually fits on this slot. */
  fits: boolean;
};

export async function openSlotsForItem(
  locationId: string,
  itemId: string,
  days = 60,
  /** The booking being moved, as customer_type_id -> units. Makes `fits` exact. */
  cart?: Cart,
): Promise<OpenSlot[]> {
  const db = getDb();
  const item = (
    await db
      .select()
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.locationId, locationId)))
      .limit(1)
  )[0];
  if (!item) return [];
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);
  const slots = await db
    .select({ a: availabilities, cap: availabilitySchedules.capacityPerSlot })
    .from(availabilities)
    .leftJoin(availabilitySchedules, eq(availabilities.scheduleId, availabilitySchedules.id))
    .where(
      and(
        eq(availabilities.itemId, itemId),
        gte(availabilities.startsAt, now),
        lt(availabilities.startsAt, until),
        ne(availabilities.onlineBookingStatus, "off"),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
  if (slots.length === 0) return [];

  const ids = slots.map((s) => s.a.id);
  const booked = await db
    .select({ availabilityId: bookings.availabilityId, qty: bookingLines.quantity })
    .from(bookings)
    .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .where(and(inArray(bookings.availabilityId, ids), eq(bookings.status, "active")));
  const bySlot = new Map<string, number>();
  for (const b of booked) bySlot.set(b.availabilityId, (bySlot.get(b.availabilityId) ?? 0) + b.qty);

  // Raw pools + per-customer-type requirements. Deliberately NOT collapsed to one row per
  // resource: two options drawing on DIFFERENT pools (Miami's 2-Seat and 4-Seat UTVs) are
  // alternatives, and collapsing them made the scarcer one cap the whole tour.
  const { pools, requirements } =
    item.capacityMode === "resource_based"
      ? await poolsAndRequirementsForItem(itemId)
      : { pools: [], requirements: [] };

  // Shared-pool usage: peak concurrent use of each resource by EVERY tour overlapping the slot, not
  // just this one. Without it, two tours on the same machines each see the whole fleet as free.
  const usage =
    item.capacityMode === "resource_based"
      ? await overlappingResourceUsage(
          slots.map(({ a }) => ({ id: a.id, startsAt: a.startsAt, endsAt: a.endsAt })),
          item.locationId,
        )
      : new Map();

  return slots.map(({ a, cap }) => {
    const bk = bySlot.get(a.id) ?? 0;
    if (item.capacityMode === "fixed") {
      const remaining = fixedRemaining(a.capacityOverride ?? cap, bk);
      return {
        id: a.id,
        startsAt: a.startsAt,
        remaining,
        perType: [],
        fits: cart ? bk + cartSize(cart) <= (a.capacityOverride ?? cap ?? 0) : remaining > 0,
      };
    }
    const live = withUsage(pools, usage.get(a.id));
    return {
      id: a.id,
      startsAt: a.startsAt,
      // Total vehicles still sellable across the tour's options. Display only.
      remaining: slotRemaining(live, requirements),
      perType: [...remainingByType(live, requirements)].map(([customerTypeId, remaining]) => ({
        customerTypeId,
        remaining,
      })),
      // With a cart in hand this is exact — a booking of one four-seater needs a slot with a free
      // four-seater, not merely a slot with three free two-seaters. Without one, fall back to
      // "anything at all can be sold here", which is a max over options and never a min.
      fits: cart ? cartFits(cart, live, requirements) : bestTypeRemaining(live, requirements) > 0,
    };
  });
}

function cartSize(cart: Cart): number {
  let n = 0;
  for (const q of cart.values()) n += q;
  return n;
}

export type ReschedulableSlot = OpenSlot & { itemId: string; itemName: string };

/**
 * Every slot a booking could be moved into, across EVERY tour at the location.
 *
 * Cross-tour reschedule has worked server-side for a while — `rescheduleBooking` re-prices against
 * the target and only refuses when a rider type is not offered there. What did not work was reaching
 * it: this list was built inline inside `getBookingModalData` and so existed only in the booking
 * MODAL, opened from search, recent bookings and the manifest. The booking DETAIL page built its own
 * picker from a single item, and the no-shows report links to the detail page.
 *
 * So a rep working the Houston call list could not offer a Glow no-show a day tour — the option was
 * not on screen — even though Dallas Glow and the Dallas day tour share both rider types at identical
 * prices, and four such moves had already gone through from the modal. Shared here so both surfaces
 * ask the same question.
 *
 * `cart` is the booking being moved, so `fits` is that basket against that slot rather than a
 * headline count: a booking for one four-seater does not fit a slot whose free machines are all
 * two-seaters.
 *
 * ⚠️ Only `bookable_online` tours are offered. `rescheduleBooking` itself would accept an
 * operator-only tour, so this is the picker being stricter than the action — harmless today because
 * every live item is bookable online, but it is the reason an offline tour would silently not appear.
 */
export async function reschedulableSlots(
  locationId: string,
  cart: Cart,
  days = 60,
): Promise<ReschedulableSlot[]> {
  const bookable = await getDb()
    .select({ id: items.id, name: items.name })
    .from(items)
    .where(and(eq(items.locationId, locationId), eq(items.bookableOnline, true)))
    .orderBy(asc(items.sortOrder));

  const perTour = await Promise.all(
    bookable.map(async (it) => {
      const slots = await openSlotsForItem(locationId, it.id, days, cart);
      return slots.map((sl) => ({ ...sl, itemId: it.id, itemName: it.name }));
    }),
  );
  return perTour.flat().sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}
