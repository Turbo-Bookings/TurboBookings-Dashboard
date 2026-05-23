import { notFound } from "next/navigation";
import { IntegrationsForm } from "@/components/IntegrationsForm";
import { StripeConnectCard } from "@/components/StripeConnectCard";
import {
  getSecretSummariesForLocation,
  vercelApiTokenStatus,
} from "@/lib/actions/integrations";
import { refreshStripeAccountStatus } from "@/lib/actions/stripe-connect";
import { stripeConfigured } from "@/lib/stripe/client";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function IntegrationsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const [summaries, tokenConfigured, stripeStatus] = await Promise.all([
    getSecretSummariesForLocation(loc.id),
    vercelApiTokenStatus(),
    refreshStripeAccountStatus(slug),
  ]);

  return (
    <div className="mt-6 space-y-8">
      <div className="max-w-2xl">
        <p className="text-sm text-zinc-500">
          Per-location secrets + Stripe Connect onboarding. Values are
          encrypted at rest and pushed to the location&apos;s Vercel env when{" "}
          <code className="font-mono">VERCEL_API_TOKEN</code> is configured.
        </p>
      </div>

      <section className="space-y-3">
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
    </div>
  );
}
