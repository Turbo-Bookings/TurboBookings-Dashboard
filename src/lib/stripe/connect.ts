import "server-only";
import { getStripe } from "./client";

// Stripe Connect onboarding helpers — Standard accounts, Direct charges
// with application_fee_amount per the locked design.
//
// Onboarding flow:
//   1. Client clicks "Connect Stripe" in dashboard → server creates an
//      Express/Standard account (createConnectAccount) and persists the
//      account.id on locations.stripe_account_id immediately.
//   2. Server generates an Account Link (createOnboardingLink) and
//      redirects the client to Stripe's hosted onboarding.
//   3. Client completes KYC + bank in Stripe's UI. Stripe redirects back
//      to our `return_url` (dashboard's Integrations tab).
//   4. We fetch the account (fetchAccountStatus) to check
//      details_submitted + charges_enabled + payouts_enabled.

export type AccountStatus = {
  id: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  // The legal business name from Stripe — what shows on customer card
  // statements. Useful to display "Connected as <Brandon Takeover LLC>"
  // in the dashboard.
  businessProfileName: string | null;
  emailHint: string | null;
};

// Creates a Standard connected account. Standard means the client has full
// access to Stripe's dashboard for their account — easiest to onboard and
// lowest support burden on us.
export async function createConnectAccount(opts: {
  /** Owner email — pre-fills Stripe's onboarding so client doesn't retype */
  email?: string;
  /** Location slug — stored as metadata for cross-reference */
  locationSlug: string;
  /** Country code (ISO 3166-1 alpha-2). US-only for V1 */
  country?: string;
}): Promise<string> {
  const stripe = getStripe();
  const account = await stripe.accounts.create({
    type: "standard",
    country: opts.country ?? "US",
    email: opts.email,
    metadata: {
      tb_location_slug: opts.locationSlug,
    },
  });
  return account.id;
}

// Generates a hosted-onboarding URL for the client. URLs are short-lived;
// regenerate each time the client clicks "Connect" / "Continue onboarding."
export async function createOnboardingLink(opts: {
  accountId: string;
  returnUrl: string;
  refreshUrl: string;
}): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.accountLinks.create({
    account: opts.accountId,
    type: "account_onboarding",
    return_url: opts.returnUrl,
    refresh_url: opts.refreshUrl,
  });
  return link.url;
}

// Snapshot of the connected account's status. Called on the dashboard's
// Integrations tab to show "Connected ✓" or "Continue onboarding."
export async function fetchAccountStatus(
  accountId: string,
): Promise<AccountStatus> {
  const stripe = getStripe();
  const acct = await stripe.accounts.retrieve(accountId);
  return {
    id: acct.id,
    detailsSubmitted: acct.details_submitted,
    chargesEnabled: acct.charges_enabled,
    payoutsEnabled: acct.payouts_enabled,
    businessProfileName: acct.business_profile?.name ?? null,
    emailHint: acct.email ?? null,
  };
}

// Sign-in link to the connected account's Stripe dashboard. Client uses
// this to view their Stripe data without leaving our portal.
export async function createDashboardLoginLink(
  accountId: string,
): Promise<string> {
  const stripe = getStripe();
  const link = await stripe.accounts.createLoginLink(accountId);
  return link.url;
}
