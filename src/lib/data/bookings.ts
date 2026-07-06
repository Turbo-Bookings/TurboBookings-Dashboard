import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  auditLog,
  availabilities,
  availabilitySchedules,
  bookingCustomFieldValues,
  bookingHolds,
  bookingLines,
  bookingReschedules,
  bookings,
  customFields,
  customerTypes,
  customers,
  getDb,
  items,
  paymentMethodsOnFile,
  payments,
  resourceRequirements,
  resources,
} from "@/lib/db";
import { fixedRemaining, resourceRemaining, type ResourcePool } from "@/lib/booking/capacity";

export type CheckInRollup = "not_yet" | "checked_in" | "no_show" | "partial";

// Roll a booking's per-vehicle check-in counts up to one status.
export function bookingRollup(
  lines: { quantity: number; checkedInUnits: number; noShowUnits: number }[],
): CheckInRollup {
  let q = 0, c = 0, n = 0;
  for (const l of lines) {
    q += l.quantity;
    c += l.checkedInUnits;
    n += l.noShowUnits;
  }
  if (q === 0 || (c === 0 && n === 0)) return "not_yet";
  if (c === q) return "checked_in";
  if (n === q) return "no_show";
  return "partial";
}

// ---------- Manifest (day-of view) ----------

export type ManifestLine = {
  id: string;
  ctName: string;
  quantity: number;
  checkedInUnits: number;
  noShowUnits: number;
};
export type ManifestBooking = {
  id: string;
  displayNumber: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  balanceDueCents: number;
  partySize: number;
  notes: string | null;
  rollup: CheckInRollup;
  lines: ManifestLine[];
};
export type ManifestSlot = {
  availabilityId: string;
  itemId: string;
  itemName: string;
  onlineStatus: string;
  capacityMode: "resource_based" | "fixed";
  startsAt: Date;
  endsAt: Date;
  baseCapacity: number | null;
  booked: number;
  bookings: ManifestBooking[];
};

export async function manifestForDate(
  locationId: string,
  dateKey: string,
  tz: string,
): Promise<ManifestSlot[]> {
  const db = getDb();
  const zone = tz || "utc";
  const dayStart = DateTime.fromISO(dateKey, { zone }).startOf("day");
  if (!dayStart.isValid) return [];
  const start = dayStart.toUTC().toJSDate();
  const end = dayStart.plus({ days: 1 }).toUTC().toJSDate();

  const slots = await db
    .select({
      a: availabilities,
      itemName: items.name,
      capacityMode: items.capacityMode,
      schedCap: availabilitySchedules.capacityPerSlot,
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
  if (slots.length === 0) return [];

  const slotIds = slots.map((s) => s.a.id);
  const rows = await db
    .select({
      availabilityId: bookings.availabilityId,
      bookingId: bookings.id,
      displayNumber: bookings.displayNumber,
      status: bookings.status,
      balanceDueCents: bookings.balanceDueCents,
      notes: bookings.notes,
      custFirst: customers.firstName,
      custLast: customers.lastName,
      custPhone: customers.phoneE164,
      lineId: bookingLines.id,
      ctName: customerTypes.singular,
      quantity: bookingLines.quantity,
      checkedInUnits: bookingLines.checkedInUnits,
      noShowUnits: bookingLines.noShowUnits,
    })
    .from(bookings)
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .innerJoin(customerTypes, eq(bookingLines.customerTypeId, customerTypes.id))
    .where(
      and(
        inArray(bookings.availabilityId, slotIds),
        eq(bookings.status, "active"),
      ),
    );

  // Assemble bookings per slot.
  const byBooking = new Map<string, ManifestBooking & { availabilityId: string }>();
  for (const r of rows) {
    let b = byBooking.get(r.bookingId);
    if (!b) {
      b = {
        availabilityId: r.availabilityId,
        id: r.bookingId,
        displayNumber: r.displayNumber,
        customerName: [r.custFirst, r.custLast].filter(Boolean).join(" ") || "—",
        customerPhone: r.custPhone,
        status: r.status,
        balanceDueCents: r.balanceDueCents,
        partySize: 0,
        notes: r.notes,
        rollup: "not_yet",
        lines: [],
      };
      byBooking.set(r.bookingId, b);
    }
    b.lines.push({
      id: r.lineId,
      ctName: r.ctName,
      quantity: r.quantity,
      checkedInUnits: r.checkedInUnits,
      noShowUnits: r.noShowUnits,
    });
    b.partySize += r.quantity;
  }
  for (const b of byBooking.values()) b.rollup = bookingRollup(b.lines);

  return slots.map((s) => {
    const bs = [...byBooking.values()].filter(
      (b) => b.availabilityId === s.a.id,
    );
    return {
      availabilityId: s.a.id,
      itemId: s.a.itemId,
      itemName: s.itemName,
      onlineStatus: s.a.onlineBookingStatus,
      capacityMode: s.capacityMode,
      startsAt: s.a.startsAt,
      endsAt: s.a.endsAt,
      baseCapacity:
        s.capacityMode === "fixed" ? s.a.capacityOverride ?? s.schedCap : null,
      booked: bs.reduce((n, b) => n + b.partySize, 0),
      bookings: bs,
    };
  })
    // Manifest only shows slots that actually have bookings.
    .filter((slot) => slot.bookings.length > 0);
}

// ---------- Bookings grid (calendar) ----------

export type GridSlot = {
  availabilityId: string;
  itemId: string;
  itemName: string;
  startsAt: Date;
  endsAt: Date;
  onlineStatus: string;
  booked: number;
  available: number | null;
  full: boolean;
  bookingCount: number;
  capacityMode: "resource_based" | "fixed";
  capacityOverride: number | null;
  riderCounts: { ctName: string; booked: number }[];
};

export async function gridForDate(
  locationId: string,
  dateKey: string,
  tz: string,
): Promise<GridSlot[]> {
  const db = getDb();
  const zone = tz || "utc";
  const dayStart = DateTime.fromISO(dateKey, { zone }).startOf("day");
  if (!dayStart.isValid) return [];
  const start = dayStart.toUTC().toJSDate();
  const end = dayStart.plus({ days: 1 }).toUTC().toJSDate();

  const slots = await db
    .select({
      a: availabilities,
      itemName: items.name,
      capacityMode: items.capacityMode,
      schedCap: availabilitySchedules.capacityPerSlot,
    })
    .from(availabilities)
    .innerJoin(items, eq(availabilities.itemId, items.id))
    .leftJoin(availabilitySchedules, eq(availabilities.scheduleId, availabilitySchedules.id))
    .where(
      and(
        eq(items.locationId, locationId),
        gte(availabilities.startsAt, start),
        lt(availabilities.startsAt, end),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
  if (slots.length === 0) return [];

  const slotIds = slots.map((s) => s.a.id);
  const bookedRows = await db
    .select({
      bookingId: bookings.id,
      availabilityId: bookings.availabilityId,
      qty: bookingLines.quantity,
      ctName: customerTypes.singular,
    })
    .from(bookings)
    .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
    .innerJoin(customerTypes, eq(bookingLines.customerTypeId, customerTypes.id))
    .where(and(inArray(bookings.availabilityId, slotIds), eq(bookings.status, "active")));
  const bookedBySlot = new Map<string, number>();
  const typeBySlot = new Map<string, Map<string, number>>();
  const bookingIdsBySlot = new Map<string, Set<string>>();
  for (const r of bookedRows) {
    bookedBySlot.set(r.availabilityId, (bookedBySlot.get(r.availabilityId) ?? 0) + r.qty);
    let ids = bookingIdsBySlot.get(r.availabilityId);
    if (!ids) {
      ids = new Set();
      bookingIdsBySlot.set(r.availabilityId, ids);
    }
    ids.add(r.bookingId);
    let m = typeBySlot.get(r.availabilityId);
    if (!m) {
      m = new Map();
      typeBySlot.set(r.availabilityId, m);
    }
    m.set(r.ctName, (m.get(r.ctName) ?? 0) + r.qty);
  }

  // Resource pools per resource-based item (for available counts).
  const resourceItemIds = [
    ...new Set(slots.filter((s) => s.capacityMode === "resource_based").map((s) => s.a.itemId)),
  ];
  const poolsByItem = new Map<string, { max: number; oos: number; maxQ: number }[]>();
  if (resourceItemIds.length) {
    const rr = await db
      .select({ itemId: resourceRequirements.itemId, rr: resourceRequirements, r: resources })
      .from(resourceRequirements)
      .innerJoin(resources, eq(resourceRequirements.resourceId, resources.id))
      .where(inArray(resourceRequirements.itemId, resourceItemIds));
    const byItemRes = new Map<string, Map<string, { max: number; oos: number; maxQ: number }>>();
    for (const row of rr) {
      let m = byItemRes.get(row.itemId);
      if (!m) {
        m = new Map();
        byItemRes.set(row.itemId, m);
      }
      const cur = m.get(row.r.id);
      if (!cur)
        m.set(row.r.id, { max: row.r.maxConcurrentUses, oos: row.r.outOfServiceCount, maxQ: row.rr.quantityConsumed });
      else cur.maxQ = Math.max(cur.maxQ, row.rr.quantityConsumed);
    }
    for (const [itemId, m] of byItemRes) poolsByItem.set(itemId, [...m.values()]);
  }

  return slots.map((s) => {
    const booked = bookedBySlot.get(s.a.id) ?? 0;
    let available: number | null;
    if (s.capacityMode === "fixed") {
      const base = s.a.capacityOverride ?? s.schedCap;
      available = base != null ? fixedRemaining(base, booked) : null;
    } else {
      const pools = poolsByItem.get(s.a.itemId) ?? [];
      available = pools.length
        ? resourceRemaining(
            pools.map<ResourcePool>((p) => ({
              maxConcurrentUses: p.max,
              outOfServiceCount: p.oos,
              maxQuantityConsumed: p.maxQ,
              consumed: booked,
            })),
          )
        : null;
    }
    return {
      availabilityId: s.a.id,
      itemId: s.a.itemId,
      itemName: s.itemName,
      startsAt: s.a.startsAt,
      endsAt: s.a.endsAt,
      onlineStatus: s.a.onlineBookingStatus,
      booked,
      available,
      full: available != null && available <= 0,
      bookingCount: bookingIdsBySlot.get(s.a.id)?.size ?? 0,
      capacityMode: s.capacityMode,
      capacityOverride: s.a.capacityOverride,
      riderCounts: [...(typeBySlot.get(s.a.id)?.entries() ?? [])].map(([ctName, b]) => ({
        ctName,
        booked: b,
      })),
    };
  });
}

// ---------- Bookings list ----------

export type BookingListRow = {
  id: string;
  displayNumber: string;
  status: string;
  source: string;
  startsAt: Date;
  itemName: string;
  customerName: string;
  totalCents: number;
  depositPaidCents: number;
};

export async function listBookings(
  locationId: string,
  opts: { from?: Date; to?: Date; status?: string; q?: string } = {},
): Promise<BookingListRow[]> {
  const db = getDb();
  const where = [eq(bookings.locationId, locationId)];
  if (opts.from) where.push(gte(availabilities.startsAt, opts.from));
  if (opts.to) where.push(lt(availabilities.startsAt, opts.to));
  if (opts.status && opts.status !== "all")
    where.push(eq(bookings.status, opts.status as "active"));
  if (opts.q) {
    const like = `%${opts.q}%`;
    const cond = or(
      ilike(customers.emailLower, like),
      ilike(customers.firstName, like),
      ilike(customers.lastName, like),
      ilike(bookings.displayNumber, like),
    );
    if (cond) where.push(cond);
  }
  const rows = await db
    .select({
      id: bookings.id,
      displayNumber: bookings.displayNumber,
      status: bookings.status,
      source: bookings.source,
      startsAt: availabilities.startsAt,
      itemName: items.name,
      custFirst: customers.firstName,
      custLast: customers.lastName,
      totalCents: bookings.totalCents,
      depositPaidCents: bookings.depositPaidCents,
    })
    .from(bookings)
    .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
    .innerJoin(items, eq(bookings.itemId, items.id))
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .where(and(...where))
    .orderBy(desc(availabilities.startsAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    displayNumber: r.displayNumber,
    status: r.status,
    source: r.source,
    startsAt: r.startsAt,
    itemName: r.itemName,
    customerName: [r.custFirst, r.custLast].filter(Boolean).join(" ") || "—",
    totalCents: r.totalCents,
    depositPaidCents: r.depositPaidCents,
  }));
}

// ---------- Booking detail ----------

export async function getBookingDetail(id: string, locationId: string) {
  const db = getDb();
  const b = (
    await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, id), eq(bookings.locationId, locationId)))
      .limit(1)
  )[0];
  if (!b) return null;

  const [item, slot, customer, lines, pays, holds, reschedules, fieldValues, activity] =
    await Promise.all([
      db.select().from(items).where(eq(items.id, b.itemId)).limit(1),
      db.select().from(availabilities).where(eq(availabilities.id, b.availabilityId)).limit(1),
      db.select().from(customers).where(eq(customers.id, b.customerId)).limit(1),
      db
        .select({
          id: bookingLines.id,
          customerTypeId: bookingLines.customerTypeId,
          ctName: customerTypes.singular,
          quantity: bookingLines.quantity,
          unitPriceCents: bookingLines.unitPriceCents,
          checkedInUnits: bookingLines.checkedInUnits,
          noShowUnits: bookingLines.noShowUnits,
        })
        .from(bookingLines)
        .innerJoin(customerTypes, eq(bookingLines.customerTypeId, customerTypes.id))
        .where(eq(bookingLines.bookingId, id)),
      db.select().from(payments).where(eq(payments.bookingId, id)),
      db
        .select({ hold: bookingHolds, last4: paymentMethodsOnFile.last4, brand: paymentMethodsOnFile.brand })
        .from(bookingHolds)
        .leftJoin(
          paymentMethodsOnFile,
          eq(bookingHolds.paymentMethodOnFileId, paymentMethodsOnFile.id),
        )
        .where(eq(bookingHolds.bookingId, id)),
      db
        .select()
        .from(bookingReschedules)
        .where(eq(bookingReschedules.bookingId, id))
        .orderBy(desc(bookingReschedules.createdAt)),
      db
        .select({
          label: customFields.label,
          kind: customFields.kind,
          valueText: bookingCustomFieldValues.valueText,
          valueChecked: bookingCustomFieldValues.valueChecked,
          valueDropdownSelected: bookingCustomFieldValues.valueDropdownSelected,
          valueQuantity: bookingCustomFieldValues.valueQuantity,
        })
        .from(bookingCustomFieldValues)
        .innerJoin(customFields, eq(bookingCustomFieldValues.customFieldId, customFields.id))
        .where(eq(bookingCustomFieldValues.bookingId, id)),
      db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.locationId, locationId),
            sql`${auditLog.payload}->>'bookingId' = ${id}`,
          ),
        )
        .orderBy(desc(auditLog.createdAt))
        .limit(50),
    ]);

  const cardOnFile = (
    await db
      .select()
      .from(paymentMethodsOnFile)
      .where(eq(paymentMethodsOnFile.customerId, b.customerId))
      .orderBy(desc(paymentMethodsOnFile.createdAt))
      .limit(1)
  )[0];

  return {
    booking: b,
    item: item[0] ?? null,
    slot: slot[0] ?? null,
    customer: customer[0] ?? null,
    lines,
    payments: pays,
    holds,
    reschedules,
    fieldValues,
    activity,
    cardOnFile: cardOnFile ?? null,
  };
}

// ---------- Reports ----------

export type BookingsReport = {
  bookings: number;
  pax: number;
  grossCents: number;
  paidCents: number;
  onlineCount: number;
  directCount: number;
  byTour: { name: string; bookings: number; pax: number; grossCents: number }[];
};

async function paxByBooking(ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ids.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select({ bid: bookingLines.bookingId, q: bookingLines.quantity })
    .from(bookingLines)
    .where(inArray(bookingLines.bookingId, ids));
  for (const r of rows) map.set(r.bid, (map.get(r.bid) ?? 0) + r.q);
  return map;
}

export async function bookingsReport(
  locationId: string,
  from: Date,
  to: Date,
): Promise<BookingsReport> {
  const db = getDb();
  const rows = await db
    .select({
      id: bookings.id,
      itemName: items.name,
      source: bookings.source,
      totalCents: bookings.totalCents,
      paidCents: bookings.depositPaidCents,
    })
    .from(bookings)
    .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
    .innerJoin(items, eq(bookings.itemId, items.id))
    .where(
      and(
        eq(bookings.locationId, locationId),
        eq(bookings.status, "active"),
        gte(availabilities.startsAt, from),
        lt(availabilities.startsAt, to),
      ),
    );
  const pax = await paxByBooking(rows.map((r) => r.id));
  const byTour = new Map<string, { name: string; bookings: number; pax: number; grossCents: number }>();
  let totalPax = 0, gross = 0, paid = 0, online = 0, direct = 0;
  for (const r of rows) {
    const p = pax.get(r.id) ?? 0;
    totalPax += p;
    gross += r.totalCents;
    paid += r.paidCents;
    if (r.source === "online") online++;
    else if (r.source === "direct") direct++;
    const t = byTour.get(r.itemName) ?? { name: r.itemName, bookings: 0, pax: 0, grossCents: 0 };
    t.bookings++;
    t.pax += p;
    t.grossCents += r.totalCents;
    byTour.set(r.itemName, t);
  }
  return {
    bookings: rows.length,
    pax: totalPax,
    grossCents: gross,
    paidCents: paid,
    onlineCount: online,
    directCount: direct,
    byTour: [...byTour.values()].sort((a, b) => b.grossCents - a.grossCents),
  };
}

export type CsvRow = {
  displayNumber: string;
  status: string;
  source: string;
  startsAt: Date;
  itemName: string;
  customerName: string;
  email: string;
  pax: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
};

export async function listBookingsForCsv(
  locationId: string,
  from: Date,
  to: Date,
): Promise<CsvRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: bookings.id,
      displayNumber: bookings.displayNumber,
      status: bookings.status,
      source: bookings.source,
      startsAt: availabilities.startsAt,
      itemName: items.name,
      first: customers.firstName,
      last: customers.lastName,
      email: customers.emailLower,
      totalCents: bookings.totalCents,
      paidCents: bookings.depositPaidCents,
      balanceCents: bookings.balanceDueCents,
    })
    .from(bookings)
    .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
    .innerJoin(items, eq(bookings.itemId, items.id))
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .where(
      and(
        eq(bookings.locationId, locationId),
        gte(availabilities.startsAt, from),
        lt(availabilities.startsAt, to),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
  const pax = await paxByBooking(rows.map((r) => r.id));
  return rows.map((r) => ({
    displayNumber: r.displayNumber,
    status: r.status,
    source: r.source,
    startsAt: r.startsAt,
    itemName: r.itemName,
    customerName: [r.first, r.last].filter(Boolean).join(" ") || "",
    email: r.email,
    pax: pax.get(r.id) ?? 0,
    totalCents: r.totalCents,
    paidCents: r.paidCents,
    balanceCents: r.balanceCents,
  }));
}
