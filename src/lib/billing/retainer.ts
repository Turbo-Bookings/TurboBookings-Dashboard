import "server-only";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { getStripe } from "@/lib/stripe/client";
import { getDb, locations } from "@/lib/db";
import type { Location } from "@/lib/db/schema";

// Platform-retainer billing on the PLATFORM Stripe account. Every call here uses
// getStripe() WITHOUT a { stripeAccount } option, so it runs on our own account
// (the operator's business card + subscription live on the platform, not on the
// location's connected acct_…). Separate from the 6% per-booking fee.

// Get-or-create the platform Stripe Customer for a location.
export async function ensurePlatformCustomer(location: Location): Promise<string> {
  if (location.stripePlatformCustomerId) return location.stripePlatformCustomerId;
  const customer = await getStripe().customers.create({
    name: location.brandDisplayName ?? location.slug,
    email: location.contactSupportEmail ?? undefined,
    metadata: { locationId: location.id, slug: location.slug, kind: "retainer" },
  });
  await getDb()
    .update(locations)
    .set({ stripePlatformCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(locations.id, location.id));
  return customer.id;
}

// A SetupIntent so the operator can save a card for off-session retainer charges.
export async function createRetainerSetupIntent(location: Location): Promise<string> {
  const customerId = await ensurePlatformCustomer(location);
  const si = await getStripe().setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: { locationId: location.id, slug: location.slug },
  });
  if (!si.client_secret) throw new Error("SetupIntent has no client secret");
  return si.client_secret;
}

// After the client confirms the SetupIntent, make its card the customer default
// and persist the brand/last4 for display.
export async function saveCardFromSetupIntent(
  location: Location,
  setupIntentId: string,
): Promise<{ brand: string | null; last4: string | null }> {
  const stripe = getStripe();
  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  const pm = si.payment_method;
  if (!pm || typeof pm === "string") throw new Error("SetupIntent has no payment method yet");
  const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
  if (!customerId || customerId !== location.stripePlatformCustomerId)
    throw new Error("SetupIntent customer mismatch");
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pm.id },
  });
  const brand = pm.card?.brand ?? null;
  const last4 = pm.card?.last4 ?? null;
  await getDb()
    .update(locations)
    .set({ retainerCardBrand: brand, retainerCardLast4: last4, updatedAt: new Date() })
    .where(eq(locations.id, location.id));
  return { brand, last4 };
}

// Next occurrence of `day`-of-month at 09:00 in the location tz, as a unix
// timestamp — used as the subscription trial end so the first charge lands on
// the billing day (no immediate/prorated charge).
export function nextBillingAnchor(day: number, timezone: string): number {
  const d = Math.min(Math.max(1, Math.floor(day)), 28);
  const now = DateTime.now().setZone(timezone);
  let anchor = now.set({ day: d, hour: 9, minute: 0, second: 0, millisecond: 0 });
  if (anchor <= now) anchor = anchor.plus({ months: 1 }).set({ day: d });
  return Math.floor(anchor.toSeconds());
}

// Subscription items need a Price object (prices are immutable). prices.create
// DOES support inline product_data, so we mint a fresh Price per amount.
async function createPrice(location: Location, amountCents: number): Promise<string> {
  const price = await getStripe().prices.create({
    currency: "usd",
    unit_amount: amountCents,
    recurring: { interval: "month" },
    product_data: { name: `${location.brandDisplayName ?? location.slug} — monthly retainer` },
  });
  return price.id;
}

// Start the monthly subscription. Requires a saved default card + configured
// amount/day. Trials to the next billing day.
export async function startSubscription(location: Location): Promise<string> {
  if (!location.stripePlatformCustomerId) throw new Error("No card on file");
  if (!location.retainerCents || location.retainerCents <= 0) throw new Error("Set the retainer amount first");
  if (!location.retainerBillingDay) throw new Error("Set the billing day first");
  const priceId = await createPrice(location, location.retainerCents);
  const sub = await getStripe().subscriptions.create({
    customer: location.stripePlatformCustomerId,
    items: [{ price: priceId }],
    trial_end: nextBillingAnchor(location.retainerBillingDay, location.timezone ?? "America/Chicago"),
    metadata: { locationId: location.id, slug: location.slug },
  });
  await getDb()
    .update(locations)
    .set({
      stripeSubscriptionId: sub.id,
      retainerStatus: sub.status === "past_due" ? "past_due" : "active",
      updatedAt: new Date(),
    })
    .where(eq(locations.id, location.id));
  return sub.id;
}

// Change the amount on an active subscription (prices are immutable, so we swap
// the item's inline price_data). No proration.
export async function updateSubscriptionAmount(location: Location, amountCents: number): Promise<void> {
  if (!location.stripeSubscriptionId) return;
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(location.stripeSubscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) return;
  const priceId = await createPrice(location, amountCents);
  await stripe.subscriptions.update(location.stripeSubscriptionId, {
    items: [{ id: itemId, price: priceId }],
    proration_behavior: "none",
  });
}

export async function cancelSubscription(location: Location): Promise<void> {
  if (!location.stripeSubscriptionId) return;
  await getStripe().subscriptions.cancel(location.stripeSubscriptionId);
  await getDb()
    .update(locations)
    .set({ retainerStatus: "canceled", updatedAt: new Date() })
    .where(eq(locations.id, location.id));
}
