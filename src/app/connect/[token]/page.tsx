import { and, eq, gt, isNull } from "drizzle-orm";
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
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ go?: string }>;
}) {
  const { token } = await params;
  const { go } = await searchParams;

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
      contactAddress: locations.contactAddress,
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

  // CONFIRMATION STEP. Owners of multiple locations get one link per location,
  // and the two forms look identical once you're inside Stripe — on 2026-08-17
  // an owner completed the Dallas link using his Houston business's details,
  // which no amount of validation on our side can catch after the fact. Naming
  // the business BEFORE the hand-off is the only place to prevent it.
  //
  // Gated behind ?go=1 so merely opening the link doesn't burn a Stripe
  // Account Link (they're single-use and expire in ~5 minutes).
  if (go !== "1") {
    return (
      <Shell
        title="Set up payments"
        body={
          <>
            <p>You&apos;re setting up card payments and payouts for:</p>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-base font-semibold text-zinc-900">{name}</p>
              {loc.brandLegalName && loc.brandLegalName !== name && (
                <p className="text-sm text-zinc-600">{loc.brandLegalName}</p>
              )}
              {loc.contactAddress && (
                <p className="mt-1 text-sm text-zinc-600">{loc.contactAddress}</p>
              )}
            </div>
            <p className="text-sm">
              <strong>Please check this is the right business.</strong> If you
              operate more than one location, use that location&apos;s own link —
              the details you enter next (EIN, bank account) must belong to the
              business named above.
            </p>
            <p>
              Stripe will ask for your business details, your ID, and the bank
              account that should receive payouts. It takes about 10 minutes.
            </p>
            <a
              href="?go=1"
              className="inline-flex items-center justify-center rounded-md bg-[#635bff] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#5546e0]"
            >
              Continue to Stripe
            </a>
          </>
        }
      />
    );
  }

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
      // Claim the row ONLY if it's still empty. Two near-simultaneous visits
      // (a link preview or prefetch alongside the real click) would otherwise
      // each see a null id, each create an account, and the second write would
      // orphan the first — which is exactly what happened on 2026-08-17,
      // leaving two connected accounts a minute apart.
      const claimed = await db
        .update(locations)
        .set({ stripeAccountId: accountId })
        .where(and(eq(locations.id, loc.id), isNull(locations.stripeAccountId)))
        .returning({ id: locations.id });

      if (claimed.length === 0) {
        // Someone else won the race. Use THEIR account and abandon ours (it is
        // an empty shell — no capabilities, no charges), so the owner and the
        // database agree on a single account.
        const [current] = await db
          .select({ acct: locations.stripeAccountId })
          .from(locations)
          .where(eq(locations.id, loc.id))
          .limit(1);
        if (current?.acct) accountId = current.acct;
      }
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
  // Carries ?go=1 so Stripe's return/refresh bounce lands back INSIDE the flow
  // rather than replaying the confirmation step on every hop.
  const selfUrl = `${base}/connect/${token}?go=1`;

  const link = await createOnboardingLink({
    accountId,
    returnUrl: selfUrl,
    refreshUrl: selfUrl,
  });

  redirect(link);
}
