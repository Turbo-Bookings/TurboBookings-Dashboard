"use server";

import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import {
  availabilities,
  availabilitySchedules,
  bookingLines,
  bookings,
  customers,
  getDb,
  items,
  paymentMethodsOnFile,
  payments,
  resourceRequirements,
  resources,
} from "@/lib/db";
import { fixedRemaining, resourceRemaining, type ResourcePool } from "@/lib/booking/capacity";
import { getItemPricing } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";
import { withTxn } from "@/lib/db/txn";
import { emitEvent } from "@/lib/events/emit";
import { quote } from "@/lib/pricing/quote";
import { getStripe, stripeConfigured } from "@/lib/stripe/client";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Line = { ct: string; q: number };
type Contact = { name: string; email: string; phone: string };
type Payload = {
  itemId: string;
  availabilityId: string;
  lines: Line[];
  contact: Contact;
};

// ---- capacity-aware upcoming slots for one tour ----
async function openSlotsForItem(
  locationId: string,
  itemId: string,
  days = 60,
): Promise<{ id: string; startsAt: Date; remaining: number }[]> {
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

  let pools: { max: number; oos: number; maxQ: number }[] = [];
  if (item.capacityMode === "resource_based") {
    const rr = await db
      .select({ rr: resourceRequirements, r: resources })
      .from(resourceRequirements)
      .innerJoin(resources, eq(resourceRequirements.resourceId, resources.id))
      .where(eq(resourceRequirements.itemId, itemId));
    const byRes = new Map<string, { max: number; oos: number; maxQ: number }>();
    for (const { rr: req, r } of rr) {
      const cur = byRes.get(r.id);
      if (!cur) byRes.set(r.id, { max: r.maxConcurrentUses, oos: r.outOfServiceCount, maxQ: req.quantityConsumed });
      else cur.maxQ = Math.max(cur.maxQ, req.quantityConsumed);
    }
    pools = [...byRes.values()];
  }

  return slots.map(({ a, cap }) => {
    const bk = bySlot.get(a.id) ?? 0;
    const remaining =
      item.capacityMode === "fixed"
        ? fixedRemaining(a.capacityOverride ?? cap, bk)
        : resourceRemaining(
            pools.map<ResourcePool>((p) => ({
              maxConcurrentUses: p.max,
              outOfServiceCount: p.oos,
              maxQuantityConsumed: p.maxQ,
              consumed: bk,
            })),
          );
    return { id: a.id, startsAt: a.startsAt, remaining };
  });
}

export type TourBookingData =
  | {
      ok: true;
      slots: { id: string; startsAt: string; remaining: number }[];
      pricing: { ct: string; label: string; priceCents: number; taxBps: number | null }[];
    }
  | { ok: false; error: string };

export async function getTourBookingData(
  slug: string,
  itemId: string,
): Promise<TourBookingData> {
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const [slots, pricing] = await Promise.all([
    openSlotsForItem(location.id, itemId),
    getItemPricing(itemId),
  ]);
  return {
    ok: true,
    slots: slots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), remaining: s.remaining })),
    pricing: pricing.map((p) => ({
      ct: p.customerTypeId,
      label: p.customerTypeSingular,
      priceCents: p.priceCents,
      taxBps: p.taxRateBpsOverride,
    })),
  };
}

async function buildQuote(location: Awaited<ReturnType<typeof getLocationBySlug>>, itemId: string, lines: Line[]) {
  const pricing = await getItemPricing(itemId);
  const byCt = new Map(pricing.map((p) => [p.customerTypeId, p]));
  const qlines = lines.filter((l) => l.q > 0 && byCt.has(l.ct));
  const q = quote({
    lines: qlines.map((l) => ({
      quantity: l.q,
      unitPriceCents: byCt.get(l.ct)!.priceCents,
      taxRateBpsOverride: byCt.get(l.ct)!.taxRateBpsOverride,
    })),
    depositMode: location!.depositMode,
    depositAmountCents: location!.depositAmountCents,
    depositPercentBps: location!.depositPercentBps,
    platformFeeBps: location!.platformFeeBps,
    platformFeeMode: location!.platformFeeMode,
    taxRateBps: location!.taxRateBps,
    taxMode: location!.taxMode,
  });
  return { q, qlines, byCt };
}

// Charge path — create a PaymentIntent the operator confirms via Elements.
export async function createOperatorIntent(
  slug: string,
  payload: Payload,
): Promise<{ ok: true; clientSecret: string; stripeAccount: string | null } | { ok: false; error: string }> {
  if (!stripeConfigured()) return { ok: false, error: "Payments not configured" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const { q, qlines } = await buildQuote(location, payload.itemId, payload.lines);
  if (qlines.length === 0) return { ok: false, error: "Select at least one rider" };
  if (q.totalDueOnlineCents < 50) return { ok: false, error: "Amount too low to charge" };
  const connected = location.stripeAccountId || null;
  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: q.totalDueOnlineCents,
        currency: "usd",
        automatic_payment_methods: { enabled: true },
        setup_future_usage: "off_session",
        metadata: { location_id: location.id, item_id: payload.itemId, availability_id: payload.availabilityId, source: "direct" },
        ...(connected ? { application_fee_amount: q.applicationFeeCents } : {}),
      },
      connected ? { stripeAccount: connected } : undefined,
    );
    return { ok: true, clientSecret: pi.client_secret as string, stripeAccount: connected };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Payment setup failed" };
  }
}

// Commit a direct (operator) booking — oversell-safe. If paymentIntentId given,
// records the captured payment + saved card; else pay-at-venue (balance due).
export async function createDirectBooking(
  slug: string,
  payload: Payload,
  paymentIntentId?: string,
): Promise<{ ok: true; bookingId: string } | { ok: false; error: string }> {
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  if (!payload.contact.name.trim() || !EMAIL_RE.test(payload.contact.email))
    return { ok: false, error: "Enter a name and valid email" };

  const item = (
    await getDb()
      .select()
      .from(items)
      .where(and(eq(items.id, payload.itemId), eq(items.locationId, location.id)))
      .limit(1)
  )[0];
  if (!item) return { ok: false, error: "Tour not found" };

  const { q, qlines, byCt } = await buildQuote(location, payload.itemId, payload.lines);
  if (qlines.length === 0) return { ok: false, error: "Select at least one rider" };

  // Resolve payment (charge path)
  let paid = 0;
  let pmCard: { id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null = null;
  let piId: string | null = null;
  let last4: string | null = null;
  if (paymentIntentId) {
    const pi = await getStripe().paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["payment_method"] },
      location.stripeAccountId ? { stripeAccount: location.stripeAccountId } : undefined,
    );
    if (pi.status !== "succeeded") return { ok: false, error: "Payment not completed" };
    paid = pi.amount_received ?? pi.amount;
    piId = pi.id;
    const pm = pi.payment_method && typeof pi.payment_method !== "string" ? pi.payment_method : null;
    last4 = pm?.card?.last4 ?? null;
    if (pm?.card) pmCard = { id: pm.id, brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
  }

  const total = q.subtotalCents + q.taxCents + q.feeCents;
  const balanceDue = total - paid;
  let createdBy: string | null = null;
  try {
    const { userId } = await auth();
    createdBy = userId ?? null;
  } catch {}

  try {
    const bookingId = await withTxn(async (tx) => {
      const slot = (
        await tx.select().from(availabilities).where(eq(availabilities.id, payload.availabilityId)).for("update")
      )[0];
      if (!slot) throw new Error("Time slot not found");

      // capacity recheck
      const bookedRows = await tx
        .select({ qty: bookingLines.quantity })
        .from(bookings)
        .innerJoin(bookingLines, eq(bookingLines.bookingId, bookings.id))
        .where(and(eq(bookings.availabilityId, payload.availabilityId), eq(bookings.status, "active")));
      const booked = bookedRows.reduce((s, r) => s + r.qty, 0);
      const requested = qlines.reduce((s, l) => s + l.q, 0);
      let remaining: number;
      if (item.capacityMode === "fixed") {
        let base = slot.capacityOverride;
        if (base == null && slot.scheduleId) {
          const sc = (
            await tx.select({ c: availabilitySchedules.capacityPerSlot }).from(availabilitySchedules).where(eq(availabilitySchedules.id, slot.scheduleId)).limit(1)
          )[0];
          base = sc?.c ?? null;
        }
        remaining = fixedRemaining(base, booked);
      } else {
        const rr = await tx
          .select({ rr: resourceRequirements, r: resources })
          .from(resourceRequirements)
          .innerJoin(resources, eq(resourceRequirements.resourceId, resources.id))
          .where(eq(resourceRequirements.itemId, payload.itemId));
        const byRes = new Map<string, { max: number; oos: number; maxQ: number }>();
        for (const { rr: req, r } of rr) {
          const cur = byRes.get(r.id);
          if (!cur) byRes.set(r.id, { max: r.maxConcurrentUses, oos: r.outOfServiceCount, maxQ: req.quantityConsumed });
          else cur.maxQ = Math.max(cur.maxQ, req.quantityConsumed);
        }
        remaining = resourceRemaining(
          [...byRes.values()].map<ResourcePool>((p) => ({ maxConcurrentUses: p.max, outOfServiceCount: p.oos, maxQuantityConsumed: p.maxQ, consumed: booked })),
        );
      }
      if (requested > remaining) throw new Error("Not enough capacity in this slot");

      const emailLower = payload.contact.email.toLowerCase();
      const [firstName, ...rest] = payload.contact.name.trim().split(" ");
      const lastName = rest.join(" ") || null;
      const cust = (
        await tx
          .insert(customers)
          .values({ locationId: location.id, emailLower, firstName: firstName || null, lastName, phoneE164: payload.contact.phone || null, firstSeenAt: new Date() })
          .onConflictDoUpdate({
            target: [customers.locationId, customers.emailLower],
            set: { firstName: firstName || null, lastName, phoneE164: payload.contact.phone || null, updatedAt: new Date() },
          })
          .returning()
      )[0];

      const existing = await tx.select({ d: bookings.displayNumber }).from(bookings).where(eq(bookings.locationId, location.id));
      let max = 0;
      for (const r of existing) {
        const n = parseInt(r.d, 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
      const displayNumber = String(max + 1).padStart(4, "0");

      const booking = (
        await tx
          .insert(bookings)
          .values({
            locationId: location.id,
            itemId: payload.itemId,
            availabilityId: payload.availabilityId,
            customerId: cust.id,
            displayNumber,
            source: "direct",
            status: "active",
            createdByUserId: createdBy,
            subtotalCents: q.subtotalCents,
            taxCents: q.taxCents,
            platformFeeCents: q.applicationFeeCents,
            totalCents: total,
            depositPaidCents: paid,
            balanceDueCents: balanceDue,
          })
          .returning()
      )[0];

      await tx.insert(bookingLines).values(
        qlines.map((l, i) => ({
          bookingId: booking.id,
          customerTypeId: l.ct,
          quantity: l.q,
          unitPriceCents: byCt.get(l.ct)!.priceCents,
          sortOrder: i,
        })),
      );

      if (piId) {
        await tx.insert(payments).values({
          bookingId: booking.id,
          stripePaymentIntentId: piId,
          amountCents: paid,
          applicationFeeCents: q.applicationFeeCents,
          status: "succeeded",
          capturedAt: new Date(),
          last4,
        });
        if (pmCard) {
          await tx
            .insert(paymentMethodsOnFile)
            .values({ customerId: cust.id, addedFromBookingId: booking.id, stripePaymentMethodId: pmCard.id, brand: pmCard.brand, last4: pmCard.last4, expMonth: pmCard.expMonth, expYear: pmCard.expYear })
            .onConflictDoNothing();
        }
      }
      return booking.id;
    });

    await recordAudit({
      slug,
      action: "catalog.booking.create_direct",
      summary: `Operator booking for "${item.name}"${paid > 0 ? ` · charged $${(paid / 100).toFixed(2)}` : " · pay at venue"}`,
      payload: { bookingId, paid },
    });
    await emitEvent({
      event_type: "booking.created",
      location_id: location.id,
      source_surface: "dashboard",
      data: { booking_id: bookingId, source: "direct" },
    });
    return { ok: true, bookingId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create booking" };
  }
}
