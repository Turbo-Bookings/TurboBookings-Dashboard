import { and, eq, gt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, locations } from "@/lib/db";
import { stripeConfigured } from "@/lib/stripe/client";
import {
  createConnectAccount,
  createOnboardingLink,
  fetchAccountStatus,
} from "@/lib/stripe/connect";

// PUBLIC, no-login Stripe onboarding hand-off for a location owner.
//
// Why this exists: Stripe Account Links are single-use and expire in ~5 minutes,
// so they can't be emailed. The obvious alternative — give the owner a dashboard
// login — asks a non-technical business owner to create a Clerk account and then
// navigate back to our domain, which is exactly where they get lost. So the
// owner gets ONE durable URL; every visit mints a fresh Account Link and
// redirects straight into Stripe's hosted flow.
//
// Security: the token is the only credential, so this route is written to be
// boring and tight — it never reveals whether a token merely expired vs. never
// existed, it stops working once the account can accept charges, and the token
// is rotatable/revocable from the dashboard. It grants exactly one capability:
// onboarding this location's Stripe account.
//
// Registered as public in src/middleware.ts.

export const dynamic = "force-dynamic";

function Shell({
  title,
  body,
}: {
  title: string;
  body: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-600">
          {body}
        </div>
      </div>
    </main>
  );
}

export default async function ConnectOnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!stripeConfigured()) {
    return (
      <Shell
        title="Setup isn't available right now"
        body={<p>Please contact Turbo Bookings — payments aren&apos;t configured yet.</p>}
      />
    );
  }

  const db = getDb();
  // Expiry is enforced in the query, so an expired token is indistinguishable
  // from a wrong one.
  const rows = await db
    .select({
      id: locations.id,
      slug: locations.slug,
      brandDisplayName: locations.brandDisplayName,
      brandLegalName: locations.brandLegalName,
      contactSupportEmail: locations.contactSupportEmail,
      stripeAccountId: locations.stripeAccountId,
    })
    .from(locations)
    .where(
      and(
        eq(locations.connectOnboardingToken, token),
        gt(locations.connectOnboardingTokenExpiresAt, new Date()),
      ),
    )
    .limit(1);
  const loc = rows[0];

  if (!loc) {
    return (
      <Shell
        title="This setup link is no longer valid"
        body={
          <>
            <p>
              Links expire for security. Please ask Turbo Bookings to send you a
              fresh one.
            </p>
          </>
        }
      />
    );
  }

  const name = loc.brandDisplayName ?? loc.brandLegalName ?? "your business";

  // Already done? Don't hand out another onboarding link — say so and stop.
  let accountId = loc.stripeAccountId;
  let alreadyLive = false;
  if (accountId) {
    try {
      const status = await fetchAccountStatus(accountId);
      alreadyLive = status.chargesEnabled && status.payoutsEnabled;
    } catch {
      // The stored account can't be resolved on the current key (e.g. a leftover
      // test-mode account after going live). Treat it as absent and create a
      // fresh one below rather than dead-ending the owner.
      accountId = null;
    }
  }

  if (alreadyLive) {
    return (
      <Shell
        title="You're all set"
        body={
          <p>
            {name} is already connected to Stripe and ready to accept payments.
            Nothing further is needed — you can close this page.
          </p>
        }
      />
    );
  }

  // Creating a live connected account fails until OUR platform account has
  // finished Stripe's Connect setup (platform profile + identity verification +
  // Stripe's own review). That is a fault on our side, not the owner's, so never
  // show them a raw 500 — they'd assume they broke something, or that the link
  // is a scam.
  let platformNotReady = false;
  if (!accountId) {
    try {
      accountId = await createConnectAccount({
        email: loc.contactSupportEmail ?? undefined,
        locationSlug: loc.slug,
      });
      await db
        .update(locations)
        .set({ stripeAccountId: accountId })
        .where(eq(locations.id, loc.id));
    } catch (err) {
      console.error("connect onboarding: could not create account", {
        slug: loc.slug,
        err,
      });
      platformNotReady = true;
    }
  }

  if (platformNotReady || !accountId) {
    return (
      <Shell
        title="Almost ready — one step on our side"
        body={
          <>
            <p>
              We&apos;re finishing the last of our payment-provider setup for{" "}
              {name}. Nothing is wrong with your link, and there&apos;s nothing
              you need to do right now.
            </p>
            <p>
              Please try this same link again a little later — it stays valid. We
              &apos;ll let you know as soon as it&apos;s ready.
            </p>
          </>
        }
      />
    );
  }

  // return_url and refresh_url both come back HERE, so an expired or
  // already-used link self-heals: Stripe bounces the owner back and we mint a
  // new one. That's the whole reason this page can be a durable URL.
  // Blank-safe: an env var set to "" is not undefined, so `??` would leave us
  // with an origin-less URL that Stripe would reject.
  const configuredBase = process.env.NEXT_PUBLIC_DASHBOARD_URL?.trim();
  const base = (
    configuredBase && configuredBase.length > 0
      ? configuredBase
      : "https://dashboard.turbobookings.net"
  ).replace(/\/+$/, "");
  const selfUrl = `${base}/connect/${token}`;

  const link = await createOnboardingLink({
    accountId,
    returnUrl: selfUrl,
    refreshUrl: selfUrl,
  });

  redirect(link);
}
