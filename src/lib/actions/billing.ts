"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { getDb, locations } from "@/lib/db";
import { getLocationBySlug } from "@/lib/data/locations";
import { denyIfCannot } from "@/lib/auth/roles";
import { stripePublishableKey } from "@/lib/stripe/client";
import {
  cancelSubscription,
  createRetainerSetupIntent,
  saveCardFromSetupIntent,
  startSubscription,
  updateSubscriptionAmount,
} from "@/lib/billing/retainer";

export type RetainerValues = {
  amount: string; // dollars
  billingDay: string; // 1–28
  status: string; // retainer_status
  cardBrand: string | null;
  cardLast4: string | null;
  hasCard: boolean;
  hasSubscription: boolean;
};

export async function getRetainerValues(slug: string): Promise<RetainerValues> {
  const loc = await getLocationBySlug(slug);
  return {
    amount: loc?.retainerCents != null ? String(loc.retainerCents / 100) : "",
    billingDay: loc?.retainerBillingDay != null ? String(loc.retainerBillingDay) : "",
    status: loc?.retainerStatus ?? "inactive",
    cardBrand: loc?.retainerCardBrand ?? null,
    cardLast4: loc?.retainerCardLast4 ?? null,
    hasCard: !!loc?.retainerCardLast4,
    hasSubscription: !!loc?.stripeSubscriptionId && loc.retainerStatus !== "canceled",
  };
}

// --- Operator: save a card (SetupIntent) ---

export async function createRetainerSetup(
  slug: string,
): Promise<{ ok: true; clientSecret: string; publishableKey: string } | { ok: false; error: string }> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  const loc = await getLocationBySlug(slug);
  if (!loc) return { ok: false, error: "Location not found" };
  const pk = stripePublishableKey();
  if (!pk) return { ok: false, error: "Stripe is not configured" };
  try {
    const clientSecret = await createRetainerSetupIntent(loc);
    return { ok: true, clientSecret, publishableKey: pk };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not start card setup" };
  }
}

export async function saveRetainerCard(
  slug: string,
  setupIntentId: string,
): Promise<{ ok: true; brand: string | null; last4: string | null } | { ok: false; error: string }> {
  const deny = await denyIfCannot("manage_config", slug);
  if (deny) return { ok: false, error: deny };
  const loc = await getLocationBySlug(slug);
  if (!loc) return { ok: false, error: "Location not found" };
  try {
    const { brand, last4 } = await saveCardFromSetupIntent(loc, setupIntentId);
    await recordAudit({ slug, action: "settings.billing.card_saved", summary: `Retainer card saved (${brand} ····${last4})` });
    revalidatePath(`/locations/${slug}/settings/billing`);
    return { ok: true, brand, last4 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save card" };
  }
}

// --- Admin: retainer amount + billing day (manage_platform) ---

export type RetainerFormState =
  | { ok: true; savedAt: number; values: { amount: string; billingDay: string } }
  | { ok: false; error: string; values: { amount: string; billingDay: string } };

export async function updateRetainer(
  slug: string,
  _prev: RetainerFormState | null,
  formData: FormData,
): Promise<RetainerFormState> {
  const values = {
    amount: String(formData.get("amount") ?? "").trim(),
    billingDay: String(formData.get("billingDay") ?? "").trim(),
  };
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny, values };

  const amt = Number(values.amount);
  if (!values.amount || !(amt > 0)) return { ok: false, error: "Enter a monthly amount greater than 0.", values };
  const day = Number(values.billingDay);
  if (!Number.isInteger(day) || day < 1 || day > 28)
    return { ok: false, error: "Billing day must be 1–28 (works in every month).", values };
  const cents = Math.round(amt * 100);

  const loc = await getLocationBySlug(slug);
  if (!loc) return { ok: false, error: "Location not found", values };

  const { getDb, locations } = await import("@/lib/db");
  const { eq } = await import("drizzle-orm");
  await getDb()
    .update(locations)
    .set({ retainerCents: cents, retainerBillingDay: day, updatedAt: new Date() })
    .where(eq(locations.id, loc.id));

  // Keep an active subscription's amount in sync.
  if (loc.stripeSubscriptionId && loc.retainerStatus === "active") {
    try {
      await updateSubscriptionAmount({ ...loc, retainerCents: cents }, cents);
    } catch (e) {
      return { ok: false, error: `Saved, but updating the live subscription failed: ${e instanceof Error ? e.message : "unknown"}`, values };
    }
  }

  await recordAudit({ slug, action: "settings.billing.update", summary: `Retainer $${amt.toFixed(2)}/mo on day ${day}` });
  revalidatePath(`/locations/${slug}/settings/billing`);
  revalidatePath(`/locations/${slug}/settings`);
  return { ok: true, savedAt: Date.now(), values };
}

// --- Admin: start / cancel the subscription ---

export async function startRetainer(slug: string): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny };
  const loc = await getLocationBySlug(slug);
  if (!loc) return { ok: false, error: "Location not found" };
  if (loc.stripeSubscriptionId && loc.retainerStatus !== "canceled")
    return { ok: false, error: "A retainer subscription is already running." };
  try {
    await startSubscription(loc);
    await recordAudit({ slug, action: "settings.billing.start", summary: "Started retainer subscription" });
    revalidatePath(`/locations/${slug}/settings/billing`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not start the retainer" };
  }
}

export async function cancelRetainer(slug: string): Promise<{ ok: boolean; error?: string }> {
  const deny = await denyIfCannot("manage_platform", slug);
  if (deny) return { ok: false, error: deny };
  const loc = await getLocationBySlug(slug);
  if (!loc) return { ok: false, error: "Location not found" };
  try {
    await cancelSubscription(loc);
    await recordAudit({ slug, action: "settings.billing.cancel", summary: "Canceled retainer subscription" });
    revalidatePath(`/locations/${slug}/settings/billing`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not cancel the retainer" };
  }
}
