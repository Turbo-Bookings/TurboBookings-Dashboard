import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";
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
import { overlappingResourceUsage } from "@/lib/availability/resourceUsage";

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
  const poolsByItem = new Map<string, { resourceId: string; max: number; oos: number; maxQ: number }[]>();
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
    for (const [itemId, m] of byItemRes)
      poolsByItem.set(itemId, [...m.entries()].map(([resourceId, v]) => ({ resourceId, ...v })));
  }

  // Shared-pool usage per slot. This grid is where the overbooking risk was visible: two tours on the
  // same machines at overlapping times each showed the whole fleet as available.
  const usage = resourceItemIds.length
    ? await overlappingResourceUsage(
        slots.map((s) => ({ id: s.a.id, startsAt: s.a.startsAt, endsAt: s.a.endsAt })),
        locationId,
      )
    : new Map();

  return slots.map((s) => {
    const booked = bookedBySlot.get(s.a.id) ?? 0;
    const slotUsage = usage.get(s.a.id);
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
              consumed: slotUsage?.get(p.resourceId) ?? 0,
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

  // `bookings.created_at` is `timestamp` WITHOUT time zone holding UTC, so the driver parses it in
  // the NODE PROCESS's zone — correct on Vercel (UTC), silently wrong anywhere else. Project it
  // explicitly instead of trusting the parse. Same fix as listRecentBookings in actions/bookings.ts,
  // which learned this the hard way.
  const stamps = (
    await db
      .select({
        createdAtIso: sql<string>`to_char(${bookings.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
        cancelledAtIso: sql<string | null>`to_char(${bookings.cancelledAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(bookings)
      .where(eq(bookings.id, id))
      .limit(1)
  )[0];

  return {
    booking: b,
    // Trustworthy instants for display. `cancelled_at` IS timestamptz already, but it is projected
    // here too so both render through one path.
    createdAt: stamps?.createdAtIso ? new Date(stamps.createdAtIso) : null,
    cancelledAt: stamps?.cancelledAtIso ? new Date(stamps.cancelledAtIso) : null,
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
  // Money, decomposed to match computeBooking() semantics. adjusted subtotal
  // (true tour sales, net of discount) = totalCents − platformFeeCents − taxCents;
  // that identity holds for every booking regardless of override/discount.
  salesCents: number; // Σ tour sales (adjusted subtotal, net of discount)
  collectedCents: number; // Σ WE collected online (deposit_paid), imports excluded
  balanceDueCents: number; // Σ remaining to collect at the venue
  feesCents: number; // Σ processing fee (card, passed)
  taxCents: number; // Σ tax WE collected online, imports excluded
  refundedCents: number; // Σ refunded
  onlineCount: number;
  directCount: number;
  // Bookings migrated in from a previous system (source = "api"). Their money
  // was collected by THAT system, never by us, so it is reported on its own
  // line and kept out of collectedCents / taxCents — otherwise the dashboard
  // would claim we took payments and tax we never touched. Their balance due
  // IS included above, because that is real money staff still collect.
  importedCount: number;
  importedCollectedCents: number;
  byTour: { name: string; bookings: number; pax: number; salesCents: number; collectedCents: number }[];
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
      balanceDueCents: bookings.balanceDueCents,
      feeCents: bookings.platformFeeCents,
      taxCents: bookings.taxCents,
      refundedCents: bookings.refundedCents,
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
  const byTour = new Map<string, { name: string; bookings: number; pax: number; salesCents: number; collectedCents: number }>();
  let totalPax = 0, sales = 0, collected = 0, balance = 0, fees = 0, tax = 0, refunded = 0, online = 0, direct = 0;
  let imported = 0, importedCollected = 0;
  for (const r of rows) {
    const p = pax.get(r.id) ?? 0;
    const adjusted = r.totalCents - r.feeCents - r.taxCents; // true tour sales
    // Migrated from a previous system — the deposit and its tax were collected
    // by that system, so they must not land in our "collected online" figures.
    const isImported = r.source === "api";
    totalPax += p;
    sales += adjusted;
    if (isImported) {
      imported++;
      importedCollected += r.paidCents;
    } else {
      collected += r.paidCents;
      tax += r.taxCents;
    }
    balance += r.balanceDueCents;
    fees += r.feeCents;
    refunded += r.refundedCents;
    if (r.source === "online") online++;
    else if (r.source === "direct") direct++;
    const t = byTour.get(r.itemName) ?? { name: r.itemName, bookings: 0, pax: 0, salesCents: 0, collectedCents: 0 };
    t.bookings++;
    t.pax += p;
    t.salesCents += adjusted;
    if (!isImported) t.collectedCents += r.paidCents;
    byTour.set(r.itemName, t);
  }
  return {
    bookings: rows.length,
    pax: totalPax,
    salesCents: sales,
    collectedCents: collected,
    balanceDueCents: balance,
    feesCents: fees,
    taxCents: tax,
    refundedCents: refunded,
    onlineCount: online,
    directCount: direct,
    importedCount: imported,
    importedCollectedCents: importedCollected,
    byTour: [...byTour.values()].sort((a, b) => b.salesCents - a.salesCents),
  };
}

// ---------- Cash actually collected online ----------
//
// `bookingsReport` buckets everything by TOUR DATE, which is right for
// operational figures (what is running, how many pax, what those tours sold
// for). It is wrong for money: cash arrives when the booking is made, not when
// the tour runs.
//
// That mismatch produced a genuinely alarming bug on 2026-08-18. Two real
// bookings came in that morning — $233.00 collected, fees visibly landing in
// Stripe — and the dashboard reported "Collected online: $0", because both tours
// were scheduled for Aug 22 and Aug 31 and the tile's window is
// `now - 30d → now + 1d` BY TOUR DATE. Future tours simply fell outside it. An
// operator watching money hit their account while the dashboard says zero has no
// way to tell a reporting quirk from a broken payment pipeline.
//
// So this is keyed on `payments.captured_at` — the moment Stripe took the money.
// Deliberately uses that column and not `bookings.created_at`, which is
// `timestamp WITHOUT time zone` and would compare incorrectly against a
// timezone-aware bound depending on server timezone.
//
// Imported (`source = 'api'`) bookings are excluded: their deposits were
// collected by the previous system and never moved through us.
//
// KNOWN LIMITATION: `payments.refunded_amount_cents` carries no timestamp, so a
// refund is attributed to the date of the ORIGINAL capture rather than the date
// it was issued. That keeps the net figure from ever overstating cash, at the
// cost of slightly restating a past period when an old booking is refunded. Add
// a `refunded_at` column if refund timing ever needs to be exact.
export type CashCollected = {
  payments: number;
  grossCents: number;
  refundedCents: number;
  netCents: number;
};

export async function collectedOnlineCash(
  locationId: string,
  from: Date,
  to: Date,
): Promise<CashCollected> {
  const db = getDb();
  const rows = await db
    .select({
      amountCents: payments.amountCents,
      refundedCents: payments.refundedAmountCents,
    })
    .from(payments)
    .innerJoin(bookings, eq(payments.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.locationId, locationId),
        // Migrated bookings' deposits were taken by the old system.
        ne(bookings.source, "api"),
        gte(payments.capturedAt, from),
        lt(payments.capturedAt, to),
      ),
    );
  let gross = 0;
  let refunded = 0;
  for (const r of rows) {
    gross += r.amountCents;
    refunded += r.refundedCents;
  }
  return {
    payments: rows.length,
    grossCents: gross,
    refundedCents: refunded,
    netCents: gross - refunded,
  };
}

// ---------- Bookings TAKEN in a window (sales activity) ----------
//
// `bookingsReport` answers "what is running in this period". This answers "how
// many sales did we make in this period", which is what an operator means by
// "how did we do today". Keyed on when the booking was created.
//
// The comparison casts created_at to timestamptz explicitly. The column is
// `timestamp WITHOUT time zone` holding UTC, so comparing it raw against a
// timezone-aware bound is only correct while the database session happens to be
// on UTC.
export type BookingsTaken = {
  count: number;
  pax: number;
  salesCents: number; // tour value sold, net of fee + tax
  onlineCount: number;
  directCount: number;
};

export async function bookingsTaken(
  locationId: string,
  from: Date,
  to: Date,
): Promise<BookingsTaken> {
  const db = getDb();
  const rows = await db
    .select({
      id: bookings.id,
      source: bookings.source,
      totalCents: bookings.totalCents,
      feeCents: bookings.platformFeeCents,
      taxCents: bookings.taxCents,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.locationId, locationId),
        eq(bookings.status, "active"),
        // Imported bookings were "taken" by the previous system, not by us.
        ne(bookings.source, "api"),
        gte(sql`${bookings.createdAt} at time zone 'UTC'`, from),
        lt(sql`${bookings.createdAt} at time zone 'UTC'`, to),
      ),
    );
  const pax = await paxByBooking(rows.map((r) => r.id));
  let totalPax = 0, sales = 0, online = 0, direct = 0;
  for (const r of rows) {
    totalPax += pax.get(r.id) ?? 0;
    sales += r.totalCents - r.feeCents - r.taxCents;
    if (r.source === "online") online++;
    else if (r.source === "direct") direct++;
  }
  return { count: rows.length, pax: totalPax, salesCents: sales, onlineCount: online, directCount: direct };
}

// ---------- Everything still owed at the venue ----------
//
// The dashboard previously showed "Balance to collect" from `bookingsReport`
// over a trailing 30-day TOUR-date window, which is close to meaningless: the
// balance on a tour that already ran is either collected or lost, while every
// dollar genuinely still outstanding sits on FUTURE tours that the window
// excluded. Dallas showed a small number while thousands were actually owed,
// most of it on the 185 migrated FareHarbor bookings running out to November.
//
// Imported bookings are deliberately INCLUDED. Their deposit was taken by the
// old system, but the balance is still collected at this venue, by this
// operator, in cash — it is exactly the number Richard needs.
export type Outstanding = {
  bookings: number;
  balanceCents: number;
  importedBookings: number;
  importedBalanceCents: number;
};

export async function outstandingBalance(
  locationId: string,
  fromTourDate: Date,
): Promise<Outstanding> {
  const db = getDb();
  const rows = await db
    .select({
      source: bookings.source,
      balanceDueCents: bookings.balanceDueCents,
    })
    .from(bookings)
    .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
    .where(
      and(
        eq(bookings.locationId, locationId),
        eq(bookings.status, "active"),
        gte(availabilities.startsAt, fromTourDate),
      ),
    );
  let total = 0, imported = 0, importedCount = 0;
  for (const r of rows) {
    total += r.balanceDueCents;
    if (r.source === "api") {
      importedCount++;
      imported += r.balanceDueCents;
    }
  }
  return {
    bookings: rows.length,
    balanceCents: total,
    importedBookings: importedCount,
    importedBalanceCents: imported,
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
  salesCents: number; // adjusted subtotal (tour sales)
  discountCents: number;
  feeCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  refundedCents: number;
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
      feeCents: bookings.platformFeeCents,
      taxCents: bookings.taxCents,
      discountCents: bookings.discountCents,
      refundedCents: bookings.refundedCents,
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
    salesCents: r.totalCents - r.feeCents - r.taxCents,
    discountCents: r.discountCents,
    feeCents: r.feeCents,
    taxCents: r.taxCents,
    totalCents: r.totalCents,
    paidCents: r.paidCents,
    balanceCents: r.balanceCents,
    refundedCents: r.refundedCents,
  }));
}

// ---------- Tax report ----------
//
// Sales tax TurboBookings actually collected ONLINE, on the deposits charged
// through us (bookings.taxCents = tax on the amount paid online at booking time).
// We deliberately do NOT recompute full liability on the total tour price: the
// balance is collected at the venue by the operator (and may never be, on a
// no-show), so full-price tax would overstate what moved through our system.
// How the operator handles venue-collected tax is their own books.

export type TaxReport = {
  bookings: number;
  collectedOnlineCents: number; // total deposits charged online
  taxCollectedOnlineCents: number; // tax portion of those deposits
  byTour: Array<{ name: string; bookings: number; collectedCents: number; taxCents: number }>;
};

export async function taxReport(
  locationId: string,
  from: Date,
  to: Date,
): Promise<TaxReport> {
  const db = getDb();
  const rows = await db
    .select({
      itemName: items.name,
      paidCents: bookings.depositPaidCents,
      taxCents: bookings.taxCents,
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
        // Exclude bookings migrated from a previous system: their deposit and
        // its tax were collected by THAT system's processor, not through us.
        // This report is the basis for a remittance decision, so it must only
        // ever show tax that actually passed through TurboBookings.
        ne(bookings.source, "api"),
      ),
    );
  let collected = 0, tax = 0;
  const byTour = new Map<string, { name: string; bookings: number; collectedCents: number; taxCents: number }>();
  for (const r of rows) {
    collected += r.paidCents;
    tax += r.taxCents;
    const t = byTour.get(r.itemName) ?? { name: r.itemName, bookings: 0, collectedCents: 0, taxCents: 0 };
    t.bookings++;
    t.collectedCents += r.paidCents;
    t.taxCents += r.taxCents;
    byTour.set(r.itemName, t);
  }
  return {
    bookings: rows.length,
    collectedOnlineCents: collected,
    taxCollectedOnlineCents: tax,
    byTour: [...byTour.values()].sort((a, b) => b.taxCents - a.taxCents),
  };
}

export type TaxCsvRow = {
  displayNumber: string;
  startsAt: Date;
  itemName: string;
  customerName: string;
  email: string;
  collectedOnlineCents: number;
  taxCollectedOnlineCents: number;
};

export async function listTaxRowsForCsv(
  locationId: string,
  from: Date,
  to: Date,
): Promise<TaxCsvRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      displayNumber: bookings.displayNumber,
      startsAt: availabilities.startsAt,
      itemName: items.name,
      first: customers.firstName,
      last: customers.lastName,
      email: customers.emailLower,
      paidCents: bookings.depositPaidCents,
      taxCents: bookings.taxCents,
    })
    .from(bookings)
    .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
    .innerJoin(items, eq(bookings.itemId, items.id))
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .where(
      and(
        eq(bookings.locationId, locationId),
        eq(bookings.status, "active"),
        gte(availabilities.startsAt, from),
        lt(availabilities.startsAt, to),
        // Must match taxReport's filter exactly, or the CSV export would
        // disagree with the on-screen figure it is meant to back up.
        ne(bookings.source, "api"),
      ),
    )
    .orderBy(asc(availabilities.startsAt));
  return rows.map((r) => ({
    displayNumber: r.displayNumber,
    startsAt: r.startsAt,
    itemName: r.itemName,
    customerName: [r.first, r.last].filter(Boolean).join(" ") || "",
    email: r.email,
    collectedOnlineCents: r.paidCents,
    taxCollectedOnlineCents: r.taxCents,
  }));
}
