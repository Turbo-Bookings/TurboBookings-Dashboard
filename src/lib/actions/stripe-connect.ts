"use server";
import { assertCan } from "@/lib/auth/roles";

import { randomBytes } from "node:crypto";
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
function dashboardBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    "https://dashboard.turbobookings.net"
  );
}

function buildReturnUrl(slug: string): string {
  return `${dashboardBaseUrl()}/locations/${slug}/integrations?stripe=callback`;
}

// True only when Stripe positively reports the account does not exist for the
// current key (the test→live case, or an account deleted/rejected). Returns
// FALSE on any other failure — a timeout or a 500 from Stripe must never be
// read as "gone", or we'd orphan a live connected account and create a duplicate
// that the operator then has to onboard again.
async function accountIsMissing(accountId: string): Promise<boolean> {
  try {
    await fetchAccountStatus(accountId);
    return false;
  } catch (err) {
    const e = err as {
      type?: string;
      code?: string;
      statusCode?: number;
      rawType?: string;
    };
    const invalidRequest =
      e.type === "StripeInvalidRequestError" ||
      e.rawType === "invalid_request_error";
    const missing =
      e.code === "resource_missing" ||
      e.code === "account_invalid" ||
      e.statusCode === 404;
    if (invalidRequest && missing) return true;
    // Anything else: assume the account is fine and let the caller proceed —
    // the subsequent Account Link call will surface the real error.
    console.error("stripe account existence check inconclusive", {
      accountId,
      err,
    });
    return false;
  }
}

// How long an operator onboarding link stays valid. Long enough to email and
// have the owner get to it in their own time; short enough that a leaked link
// isn't indefinitely useful.
const ONBOARDING_TOKEN_TTL_DAYS = 14;

/**
 * Mint (or re-mint) the shareable no-login onboarding URL for a location.
 *
 * Returns the full URL to hand to the location owner. Rotating is deliberate:
 * calling this again invalidates the previous link, so a mis-sent link can be
 * revoked by simply generating a new one.
 */
export async function createOperatorOnboardingLink(
  slug: string,
): Promise<{ url: string; expiresAt: Date }> {
  await assertCan("manage_config", slug);

  const db = getDb();
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.slug, slug))
    .limit(1);
  const loc = rows[0];
  if (!loc) throw new Error(`Location not found: ${slug}`);

  // 32 bytes of base64url ≈ 43 chars. This is the only thing protecting the
  // ability to attach a bank account to this location, so it must not be
  // guessable and must not be derived from the slug.
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + ONBOARDING_TOKEN_TTL_DAYS * 24 * 60 * 60_000,
  );

  await db
    .update(locations)
    .set({
      connectOnboardingToken: token,
      connectOnboardingTokenExpiresAt: expiresAt,
      updatedAt: sql`now()`,
    })
    .where(eq(locations.id, loc.id));

  await recordAudit({
    slug,
    action: "stripe.onboarding_link_created",
    summary: `Generated a Stripe onboarding link for the operator (expires ${expiresAt.toISOString().slice(0, 10)})`,
    payload: { expiresAt: expiresAt.toISOString() },
  });

  revalidatePath(`/locations/${slug}/integrations`);
  return { url: `${dashboardBaseUrl()}/connect/${token}`, expiresAt };
}

/** Revoke the shareable onboarding link without issuing a new one. */
export async function revokeOperatorOnboardingLink(slug: string): Promise<void> {
  await assertCan("manage_config", slug);
  const db = getDb();
  await db
    .update(locations)
    .set({
      connectOnboardingToken: null,
      connectOnboardingTokenExpiresAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(locations.slug, slug));
  await recordAudit({
    slug,
    action: "stripe.onboarding_link_revoked",
    summary: "Revoked the operator Stripe onboarding link",
  });
  revalidatePath(`/locations/${slug}/integrations`);
}

// Kicks off Stripe Connect onboarding for a location:
//   1. If the location already has a stripe_account_id, reuse it
//   2. Otherwise create a new Standard connected account, persist the id
//   3. Generate an Account Link and redirect the operator to it
export async function startStripeConnectOnboarding(slug: string): Promise<void> {
  await assertCan("manage_config", slug);
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

  // Reuse the stored account only if it still resolves on the CURRENT key.
  // After a test→live swap the saved test `acct_` is gone, and blindly reusing
  // it makes the Account Link call fail — leaving the operator stuck with a
  // "Connect Stripe" button that can never succeed. Only discard on a definitive
  // "no such account"; a transient Stripe/network error must not cause us to
  // abandon a perfectly good connected account and create a duplicate.
  let accountId = loc.stripeAccountId;
  if (accountId && (await accountIsMissing(accountId))) {
    await recordAudit({
      slug,
      action: "stripe.connect_account_stale",
      summary: `Stored Stripe account ${accountId} no longer resolves (likely a test→live key change); creating a new one`,
      payload: { previousAccountId: accountId },
    });
    accountId = null;
  }

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

  // Never let a Stripe lookup failure take down the Integrations page. The
  // stored id can legitimately be unresolvable — most importantly right after a
  // test→live key swap, when the saved test `acct_` no longer exists. That is
  // exactly when the operator needs this page to reconnect, so it must render.
  // A null return makes the card show its reconnect state.
  try {
    return await fetchAccountStatus(loc.stripeAccountId);
  } catch (err) {
    console.error("stripe account status lookup failed", {
      slug,
      accountId: loc.stripeAccountId,
      err,
    });
    return null;
  }
}

// Generates a fresh sign-in link to the client's own Stripe dashboard.
// Operator clicks "Open Stripe dashboard" in our Integrations tab → they
// land authenticated in Stripe's UI for the connected account.
export async function openStripeDashboardForLocation(
  slug: string,
): Promise<void> {
  await assertCan("manage_config", slug);
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
  await assertCan("manage_config", slug);
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
