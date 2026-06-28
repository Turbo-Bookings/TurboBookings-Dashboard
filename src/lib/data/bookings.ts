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
} from "@/lib/db";

type CheckIn = "not_yet" | "checked_in" | "no_show";

function rollup(statuses: CheckIn[]): "not_yet" | "checked_in" | "no_show" | "mixed" {
  if (statuses.length === 0) return "not_yet";
  const set = new Set(statuses);
  if (set.size === 1) return [...set][0];
  return "mixed";
}

// ---------- Manifest (day-of view) ----------

export type ManifestLine = {
  id: string;
  ctName: string;
  quantity: number;
  checkInStatus: CheckIn;
};
export type ManifestBooking = {
  id: string;
  displayNumber: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  balanceDueCents: number;
  partySize: number;
  rollup: "not_yet" | "checked_in" | "no_show" | "mixed";
  lines: ManifestLine[];
};
export type ManifestSlot = {
  availabilityId: string;
  itemName: string;
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
      custFirst: customers.firstName,
      custLast: customers.lastName,
      custPhone: customers.phoneE164,
      lineId: bookingLines.id,
      ctName: customerTypes.singular,
      quantity: bookingLines.quantity,
      checkInStatus: bookingLines.checkInStatus,
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
        rollup: "not_yet",
        lines: [],
      };
      byBooking.set(r.bookingId, b);
    }
    b.lines.push({
      id: r.lineId,
      ctName: r.ctName,
      quantity: r.quantity,
      checkInStatus: r.checkInStatus as CheckIn,
    });
    b.partySize += r.quantity;
  }
  for (const b of byBooking.values())
    b.rollup = rollup(b.lines.map((l) => l.checkInStatus));

  return slots.map((s) => {
    const bs = [...byBooking.values()].filter(
      (b) => b.availabilityId === s.a.id,
    );
    return {
      availabilityId: s.a.id,
      itemName: s.itemName,
      capacityMode: s.capacityMode,
      startsAt: s.a.startsAt,
      endsAt: s.a.endsAt,
      baseCapacity:
        s.capacityMode === "fixed" ? s.a.capacityOverride ?? s.schedCap : null,
      booked: bs.reduce((n, b) => n + b.partySize, 0),
      bookings: bs,
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
          ctName: customerTypes.singular,
          quantity: bookingLines.quantity,
          unitPriceCents: bookingLines.unitPriceCents,
          checkInStatus: bookingLines.checkInStatus,
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
