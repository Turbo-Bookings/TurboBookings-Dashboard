import { notFound } from "next/navigation";
import { SecretCard } from "@/components/SecretCard";
import { TrackingForm } from "@/components/TrackingForm";
import { getSecretSummariesForLocation } from "@/lib/actions/integrations";
import { getTrackingConfigForLocation } from "@/lib/actions/tracking";
import { TRACKING_SECRET_KINDS } from "@/lib/integrations/catalog";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function TrackingPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const [config, summaries] = await Promise.all([
    getTrackingConfigForLocation(loc.id),
    getSecretSummariesForLocation(loc.id),
  ]);

  return (
    <div className="mt-6 space-y-8">
      <section>
        <div className="mb-4 max-w-2xl">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Client tags
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Per-location tracking IDs (Meta Pixel, GA4, Google Ads, GTM). Saved
            values become the source of truth for runtime config — a future
            bridge pushes them into each location&apos;s Vercel Edge Config.
          </p>
        </div>
        <TrackingForm location={loc} config={config} />
      </section>

      <section>
        <div className="mb-4 max-w-2xl">
          <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Server-side events
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            CAPI / Conversions-API access tokens for server-side event uploads
            (Meta, Google Ads). The Purchase-event CAPI toggle lives in the
            Client tags section above. Tokens are encrypted at rest.
          </p>
        </div>
        <div className="space-y-4">
          {TRACKING_SECRET_KINDS.map((kind) => (
            <SecretCard
              key={kind}
              slug={loc.slug}
              kind={kind}
              summary={summaries[kind]}
              vercelProjectLinked={!!loc.vercelProjectId}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
