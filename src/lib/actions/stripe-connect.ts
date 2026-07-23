"use server";
import { assertCan } from "@/lib/auth/roles";

import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/audit";
import { getDb, locations } from "@/lib/db";
import {
  createConnectAccount,
  createDashboardLoginLink,
  createOnboardingLink,
  fetchAccountStatus,
  type AccountStatus,
} from "@/lib/stripe/connect";
import { stripeConfigured } from "@/lib/stripe/client";

// Returns the dashboard URL that Stripe redirects back to after onboarding.
// Same URL handles both `return_url` (onboarding finished) and `refresh_url`
// (link expired) — the UI shows whichever state the account is in.
function buildReturnUrl(slug: string): string {
  const base =
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    "https://dashboard.turbobookings.net";
  return `${base}/locations/${slug}/integrations?stripe=callback`;
}

// Kicks off Stripe Connect onboarding for a location:
//   1. If the location already has a stripe_account_id, reuse it
//   2. Otherwise create a new Standard connected account, persist the id
//   3. Generate an Account Link and redirect the operator to it
export async function startStripeConnectOnboarding(slug: string): Promise<void> {
  await assertCan("manage_config");
  if (!stripeConfigured()) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured on the dashboard. Set it via vercel env before continuing.",
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: locations.id,
      stripeAccountId: locations.stripeAccountId,
      contactSupportEmail: locations.contactSupportEmail,
    })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  const loc = rows[0];
  if (!loc) throw new Error(`Location not found: ${slug}`);

  let accountId = loc.stripeAccountId;
  if (!accountId) {
    accountId = await createConnectAccount({
      email: loc.contactSupportEmail ?? undefined,
      locationSlug: slug,
    });
    await db
      .update(locations)
      .set({ stripeAccountId: accountId, updatedAt: sql`now()` })
      .where(eq(locations.id, loc.id));
    await recordAudit({
      slug,
      action: "stripe.connect_account_created",
      summary: `Created Stripe Connect account ${accountId}`,
      payload: { accountId },
    });
  }

  const returnUrl = buildReturnUrl(slug);
  const link = await createOnboardingLink({
    accountId,
    returnUrl,
    refreshUrl: returnUrl,
  });

  redirect(link);
}

// Pulls the latest account status from Stripe. Called when the dashboard
// page loads + on the post-onboarding callback to refresh the UI.
export async function refreshStripeAccountStatus(
  slug: string,
): Promise<AccountStatus | null> {
  if (!stripeConfigured()) return null;

  const db = getDb();
  const rows = await db
    .select({ id: locations.id, stripeAccountId: locations.stripeAccountId })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  const loc = rows[0];
  if (!loc?.stripeAccountId) return null;

  return fetchAccountStatus(loc.stripeAccountId);
}

// Generates a fresh sign-in link to the client's own Stripe dashboard.
// Operator clicks "Open Stripe dashboard" in our Integrations tab → they
// land authenticated in Stripe's UI for the connected account.
export async function openStripeDashboardForLocation(
  slug: string,
): Promise<void> {
  await assertCan("manage_config");
  const db = getDb();
  const rows = await db
    .select({ stripeAccountId: locations.stripeAccountId })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  const acctId = rows[0]?.stripeAccountId;
  if (!acctId) throw new Error("No Stripe account connected for this location");

  const url = await createDashboardLoginLink(acctId);
  redirect(url);
}

// Disconnects the Stripe account from the location — does NOT delete the
// underlying account at Stripe (clients keep ownership of their Stripe data).
// Just removes the link so we stop using it.
export async function disconnectStripeAccount(slug: string): Promise<void> {
  await assertCan("manage_config");
  const db = getDb();
  await db
    .update(locations)
    .set({ stripeAccountId: null, updatedAt: sql`now()` })
    .where(eq(locations.slug, slug));

  await recordAudit({
    slug,
    action: "stripe.disconnect",
    summary: "Disconnected Stripe Connect account",
  });

  revalidatePath(`/locations/${slug}/integrations`);
}
