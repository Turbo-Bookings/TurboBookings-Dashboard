"use server";

import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import {
  availabilities,
  availabilitySchedules,
  bookingCustomFieldValues,
  bookingLines,
  bookings,
  customers,
  discountCodes,
  discountRedemptions,
  getDb,
  items,
  paymentMethodsOnFile,
  payments,
  resourceRequirements,
  resources,
} from "@/lib/db";
import { fixedRemaining, resourceRemaining, type ResourcePool } from "@/lib/booking/capacity";
import { overlappingResourceUsage, overlappingUsageForSlot } from "@/lib/availability/resourceUsage";
import { validateDiscountForBooking, type DiscountLine } from "@/lib/booking/discount";
import { getItemPricing } from "@/lib/data/items";
import { getWholeBookingFieldsForItem } from "@/lib/data/customFields";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import { withTxn } from "@/lib/db/txn";
import { phoneForStorage } from "@/lib/phone";
import { buildBookingCreatedPayload } from "@/lib/events/bookingCreatedPayload";
import { emitEvent } from "@/lib/events/emit";
import { notifyManualBookingEmails } from "@/lib/booking/notifyManualBookingEmails";
import { computeBooking, type AmountMode, type PaymentMethod } from "@/lib/pricing/breakdown";
import { getStripe, stripeConfigured } from "@/lib/stripe/client";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Line = { ct: string; q: number };
type Contact = { name: string; email: string; phone: string };
export type { AmountMode, PaymentMethod } from "@/lib/pricing/breakdown";
type Payload = {
  itemId: string;
  availabilityId: string;
  lines: Line[];
  contact: Contact;
  note?: string;
  subtotalOverrideCents?: number | null;
  discountCode?: string;
  acknowledgments?: { fieldId: string; checked: boolean }[];
  paymentMethod?: PaymentMethod;
  amountMode?: AmountMode;
  amountCents?: number; // partial charge amount, or Groupon/OTA prepaid amount
};

// ---- capacity-aware upcoming slots for one tour ----
export async function openSlotsForItem(
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

  let pools: { resourceId: string; max: number; oos: number; maxQ: number }[] = [];
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
    pools = [...byRes.entries()].map(([resourceId, v]) => ({ resourceId, ...v }));
  }

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
    const slotUsage = usage.get(a.id);
    const remaining =
      item.capacityMode === "fixed"
        ? fixedRemaining(a.capacityOverride ?? cap, bk)
        : resourceRemaining(
            pools.map<ResourcePool>((p) => ({
              maxConcurrentUses: p.max,
              outOfServiceCount: p.oos,
              maxQuantityConsumed: p.maxQ,
              consumed: slotUsage?.get(p.resourceId) ?? 0,
            })),
          );
    return { id: a.id, startsAt: a.startsAt, remaining };
  });
}

export type TourField = {
  id: string;
  kind: string;
  label: string;
  helpText: string | null;
  required: boolean;
};
export type TourBookingData =
  | {
      ok: true;
      slots: { id: string; startsAt: string; remaining: number }[];
      pricing: { ct: string; label: string; priceCents: number; taxBps: number | null }[];
      customFields: TourField[];
    }
  | { ok: false; error: string };

export async function getTourBookingData(
  slug: string,
  itemId: string,
): Promise<TourBookingData> {
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const [slots, pricing, fields] = await Promise.all([
    openSlotsForItem(location.id, itemId),
    getItemPricing(itemId),
    getWholeBookingFieldsForItem(itemId),
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
    customFields: fields.map((f) => ({
      id: f.id,
      kind: f.kind,
      label: f.label,
      helpText: f.helpText,
      required: f.required,
    })),
  };
}

// Validate a discount code from the booking form (live preview). `opts` mirrors
// the authoritative path so per-item + day-of-week codes preview correctly.
export async function applyDiscountPreview(
  slug: string,
  itemId: string,
  ctIds: string[],
  subtotalCents: number,
  code: string,
  opts?: { lines?: DiscountLine[]; availabilityId?: string },
): Promise<
  | { ok: true; appliedAmountCents: number; label: string; code: string }
  | { ok: false; error: string }
> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  let tourStartsAt: Date | undefined;
  if (opts?.availabilityId) {
    tourStartsAt = (
      await getDb()
        .select({ startsAt: availabilities.startsAt })
        .from(availabilities)
        .where(eq(availabilities.id, opts.availabilityId))
        .limit(1)
    )[0]?.startsAt;
  }
  const r = await validateDiscountForBooking(
    location.id,
    code,
    itemId,
    ctIds,
    Math.max(0, Math.round(subtotalCents)),
    { lines: opts?.lines, tourStartsAt, timezone: location.timezone ?? "America/Chicago" },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, appliedAmountCents: r.appliedAmountCents, label: r.label, code: code.trim() };
}

type Location = NonNullable<Awaited<ReturnType<typeof getLocationBySlug>>>;

// Authoritative server-side pricing: line subtotal → override → discount →
// tax/fee → deposit. Never trust client amounts.
async function computePricing(location: Location, payload: Payload) {
  const pricing = await getItemPricing(payload.itemId);
  const byCt = new Map(pricing.map((p) => [p.customerTypeId, p]));
  const qlines = payload.lines.filter((l) => l.q > 0 && byCt.has(l.ct));
  const lineSubtotal = qlines.reduce((s, l) => s + l.q * byCt.get(l.ct)!.priceCents, 0);
  const override =
    payload.subtotalOverrideCents != null && payload.subtotalOverrideCents >= 0
      ? Math.round(payload.subtotalOverrideCents)
      : null;
  const baseSubtotal = override ?? lineSubtotal;

  let discount: { discountCodeId: string; appliedAmountCents: number } | null = null;
  let discountError: string | null = null;
  if (payload.discountCode && payload.discountCode.trim()) {
    const slot = (
      await getDb()
        .select({ startsAt: availabilities.startsAt })
        .from(availabilities)
        .where(eq(availabilities.id, payload.availabilityId))
        .limit(1)
    )[0];
    const r = await validateDiscountForBooking(
      location.id,
      payload.discountCode,
      payload.itemId,
      qlines.map((l) => l.ct),
      baseSubtotal,
      {
        lines: qlines.map((l) => ({
          customerTypeId: l.ct,
          quantity: l.q,
          unitPriceCents: byCt.get(l.ct)!.priceCents,
        })),
        tourStartsAt: slot?.startsAt,
        timezone: location.timezone ?? "America/Chicago",
      },
    );
    if (r.ok) discount = { discountCodeId: r.discountCodeId, appliedAmountCents: r.appliedAmountCents };
    else discountError = r.error;
  }

  const totalQty = qlines.reduce((s, l) => s + l.q, 0);
  const c = computeBooking({
    baseSubtotalCents: baseSubtotal,
    discountCents: discount?.appliedAmountCents ?? 0,
    taxRateBps: location.taxRateBps,
    taxMode: location.taxMode,
    platformFeeBps: location.platformFeeBps,
    platformFeeMode: location.platformFeeMode,
    depositMode: location.depositMode,
    depositAmountCents: location.depositAmountCents,
    depositPercentBps: location.depositPercentBps,
    totalQty,
    paymentMethod: payload.paymentMethod ?? "walk_in",
    amountMode: payload.amountMode ?? "full",
    amountCents: payload.amountCents,
  });

  return { byCt, qlines, override, lineSubtotal, discount, discountError, c };
}

// Charge path — create a PaymentIntent the operator confirms via Elements.
export async function createOperatorIntent(
  slug: string,
  payload: Payload,
): Promise<{ ok: true; clientSecret: string; stripeAccount: string | null } | { ok: false; error: string }> {
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
  if (!stripeConfigured()) return { ok: false, error: "Payments not configured" };
  const location = await getLocationBySlug(slug);
  if (!location) return { ok: false, error: "Location not found" };
  const p = await computePricing(location, payload);
  if (p.qlines.length === 0) return { ok: false, error: "Select at least one rider" };
  if (p.discountError) return { ok: false, error: p.discountError };
  const due = p.c.dueNowCents;
  if (due < 50) return { ok: false, error: "Amount too low to charge" };
  const connected = location.stripeAccountId || null;
  // No connected account would charge the PLATFORM account instead, with no
  // application fee taken. Refuse rather than silently misroute the money.
  if (!connected)
    return {
      ok: false,
      error:
        "This location has no connected Stripe account. Finish Stripe Connect onboarding under Integrations before charging a card.",
    };
  const appFee = Math.min(p.c.applicationFeeCents, due);
  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount: due,
        currency: "usd",
        // Card only — must match `paymentMethodTypes` on <Elements> in NewBookingForm.tsx or
        // deferred-intent mode refuses to confirm. With automatic_payment_methods the rep's form
        // offered Link and Cash App Pay: a phone rep cannot complete either, and both finish via a
        // redirect that hangs the confirm promise behind an overlay. That was the frozen button.
        payment_method_types: ["card"],
        setup_future_usage: "off_session",
        metadata: { location_id: location.id, item_id: payload.itemId, availability_id: payload.availabilityId, source: "direct" },
        application_fee_amount: appFee,
      },
      // Idempotency, matching the customer checkout. A rep who clicks twice — or a retry after a
      // network blip — must not mint a second intent and take a second payment.
      { stripeAccount: connected, idempotencyKey: `op-intent:${payload.availabilityId}:${due}:${payload.contact.email.toLowerCase()}` },
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
  const deny = await denyIfCannot("manage_bookings", slug);
  if (deny) return { ok: false, error: deny };
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

  const p = await computePricing(location, payload);
  if (p.qlines.length === 0) return { ok: false, error: "Select at least one rider" };
  if (p.discountError) return { ok: false, error: p.discountError };

  // Required acknowledgments must be checked.
  const fields = await getWholeBookingFieldsForItem(payload.itemId);
  const ackMap = new Map((payload.acknowledgments ?? []).map((a) => [a.fieldId, a.checked]));
  for (const f of fields) {
    if (f.kind === "checkbox" && f.required && !ackMap.get(f.id))
      return { ok: false, error: `Please acknowledge: ${f.label}` };
  }

  const total = p.c.totalCents;
  const method: PaymentMethod = payload.paymentMethod ?? "walk_in";

  // Resolve payment
  let paid = 0;
  let pmCard: { id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null } | null = null;
  let piId: string | null = null;
  let last4: string | null = null;
  if (method === "card" && paymentIntentId) {
    // The intent was created on the connected account (createOperatorIntent
    // refuses without one), so retrieve it there. Without the account header
    // Stripe would 404 with a confusing "No such payment_intent".
    if (!location.stripeAccountId)
      return { ok: false, error: "This location has no connected Stripe account." };
    const pi = await getStripe().paymentIntents.retrieve(
      paymentIntentId,
      { expand: ["payment_method"] },
      { stripeAccount: location.stripeAccountId },
    );
    if (pi.status !== "succeeded") return { ok: false, error: "Payment not completed" };
    paid = pi.amount_received ?? pi.amount;
    piId = pi.id;
    const pm = pi.payment_method && typeof pi.payment_method !== "string" ? pi.payment_method : null;
    last4 = pm?.card?.last4 ?? null;
    if (pm?.card) pmCard = { id: pm.id, brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
  } else if (method === "groupon_ota") {
    paid = p.c.onlineBaseCents; // entered prepaid (clamped), no online fee/tax
  }

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
      const requested = p.qlines.reduce((s, l) => s + l.q, 0);
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
        // Shared across every tour overlapping this slot — `booked` sees only this availability row.
        const usage = await overlappingUsageForSlot(
          { id: payload.availabilityId, startsAt: slot.startsAt, endsAt: slot.endsAt },
          location.id,
          { db: tx },
        );
        remaining = resourceRemaining(
          [...byRes.entries()].map<ResourcePool>(([resourceId, p]) => ({ maxConcurrentUses: p.max, outOfServiceCount: p.oos, maxQuantityConsumed: p.maxQ, consumed: usage.get(resourceId) ?? 0 })),
        );
      }
      if (requested > remaining) throw new Error("Not enough capacity in this slot");

      const emailLower = payload.contact.email.toLowerCase();
      const [firstName, ...rest] = payload.contact.name.trim().split(" ");
      const lastName = rest.join(" ") || null;
      const cust = (
        await tx
          .insert(customers)
          .values({ locationId: location.id, emailLower, firstName: firstName || null, lastName, phoneE164: phoneForStorage(payload.contact.phone), firstSeenAt: new Date() })
          .onConflictDoUpdate({
            target: [customers.locationId, customers.emailLower],
            set: { firstName: firstName || null, lastName, phoneE164: phoneForStorage(payload.contact.phone), updatedAt: new Date() },
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
            subtotalCents: p.lineSubtotal,
            subtotalCentsOverride: p.override,
            taxCents: p.c.onlineTaxCents,
            platformFeeCents: p.c.feeCents,
            discountCents: p.c.discountCents,
            totalCents: total,
            depositPaidCents: paid,
            balanceDueCents: balanceDue,
            notes: payload.note?.trim() || null,
          })
          .returning()
      )[0];

      await tx.insert(bookingLines).values(
        p.qlines.map((l, i) => ({
          bookingId: booking.id,
          customerTypeId: l.ct,
          quantity: l.q,
          unitPriceCents: p.byCt.get(l.ct)!.priceCents,
          sortOrder: i,
        })),
      );

      // Whole-booking custom field responses (acknowledgments).
      const ackRows = fields
        .filter((f) => ackMap.has(f.id))
        .map((f) => ({
          bookingId: booking.id,
          customFieldId: f.id,
          valueChecked: f.kind === "checkbox" ? !!ackMap.get(f.id) : null,
        }));
      if (ackRows.length) await tx.insert(bookingCustomFieldValues).values(ackRows);

      // Discount redemption.
      if (p.discount) {
        await tx.insert(discountRedemptions).values({
          bookingId: booking.id,
          discountCodeId: p.discount.discountCodeId,
          appliedAmountCents: p.discount.appliedAmountCents,
        });
        await tx
          .update(discountCodes)
          .set({ usedCount: sql`${discountCodes.usedCount} + 1`, updatedAt: new Date() })
          .where(eq(discountCodes.id, p.discount.discountCodeId));
      }

      // Payment record (Stripe card, or non-Stripe Groupon/OTA).
      if (method === "card" && piId) {
        await tx.insert(payments).values({
          bookingId: booking.id,
          paymentGateway: "stripe",
          stripePaymentIntentId: piId,
          amountCents: paid,
          applicationFeeCents: p.c.applicationFeeCents,
          status: "succeeded",
          capturedAt: new Date(),
          paymentMethodType: "card",
          last4,
        });
        if (pmCard) {
          await tx
            .insert(paymentMethodsOnFile)
            .values({ customerId: cust.id, addedFromBookingId: booking.id, stripePaymentMethodId: pmCard.id, brand: pmCard.brand, last4: pmCard.last4, expMonth: pmCard.expMonth, expYear: pmCard.expYear })
            .onConflictDoNothing();
        }
      } else if (method === "groupon_ota" && paid > 0) {
        await tx.insert(payments).values({
          bookingId: booking.id,
          paymentGateway: "groupon_ota",
          stripePaymentIntentId: null,
          amountCents: paid,
          status: "succeeded",
          capturedAt: new Date(),
          paymentMethodType: "groupon_ota",
        });
      }
      return booking.id;
    });

    const methodLabel =
      method === "card"
        ? `charged $${(paid / 100).toFixed(2)}`
        : method === "groupon_ota"
          ? `Groupon/OTA $${(paid / 100).toFixed(2)}`
          : "walk-in (pay at venue)";
    await recordAudit({
      slug,
      action: "catalog.booking.create_direct",
      summary: `Operator booking for "${item.name}" · ${methodLabel}`,
      payload: { bookingId, paid, method },
    });
    // Full payload, matching the booking app's. This used to send only
    // `{ booking_id, source: "direct" }`, so every phone and walk-in booking reached the brains as
    // zero revenue — invisible to the spend-vs-revenue objective it is measured against.
    await emitEvent({
      event_type: "booking.created",
      location_id: location.id,
      source_surface: "dashboard",
      data: (await buildBookingCreatedPayload(bookingId)) ?? {
        booking_id: bookingId,
        source: "direct",
      },
    });
    // Send the customer their confirmation (+ arm reminders) via the booking
    // app, same as an online booking. Best-effort — never blocks the booking.
    await notifyManualBookingEmails(bookingId);
    return { ok: true, bookingId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create booking" };
  }
}
