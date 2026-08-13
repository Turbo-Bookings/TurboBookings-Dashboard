import { notFound } from "next/navigation";
import { IntegrationsForm } from "@/components/IntegrationsForm";
import { StripeConnectCard } from "@/components/StripeConnectCard";
import {
  getSecretSummariesForLocation,
  vercelApiTokenStatus,
} from "@/lib/actions/integrations";
import { refreshStripeAccountStatus } from "@/lib/actions/stripe-connect";
import { can } from "@/lib/auth/roles";
import { stripeConfigured } from "@/lib/stripe/client";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function IntegrationsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  // Per-location secrets are Turbo-only (manage_platform); operators see just
  // Stripe Connect (the secrets section is hidden below).
  const showSecrets = await can("manage_platform", slug);
  const [summaries, tokenConfigured, stripeStatus] = await Promise.all([
    getSecretSummariesForLocation(loc.id),
    vercelApiTokenStatus(),
    refreshStripeAccountStatus(slug),
  ]);

  return (
    <div className="mt-6 space-y-8">
      <div className="max-w-2xl">
        <p className="text-sm text-zinc-500">
          {showSecrets
            ? "Per-location secrets + Stripe Connect onboarding."
            : "Connect your Stripe account so you can get paid for bookings."}
        </p>
      </div>

      <section className="space-y-3" data-tour="stripe-connect">
        <header>
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Payments — Stripe Connect
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Connect this location&apos;s Stripe account so we can accept
            bookings. Direct charges land in the client&apos;s account
            (minus the platform fee).
          </p>
        </header>
        <StripeConnectCard
          slug={slug}
          accountId={loc.stripeAccountId}
          status={stripeStatus}
          stripeConfigured={stripeConfigured()}
        />
      </section>

      {showSecrets && (
        <section className="space-y-3">
          <header>
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Per-location secrets
            </h2>
          </header>
          <IntegrationsForm
            location={loc}
            summaries={summaries}
            vercelTokenConfigured={tokenConfigured}
          />
        </section>
      )}
    </div>
  );
}
