import { notFound } from "next/navigation";
import { IntegrationsForm } from "@/components/IntegrationsForm";
import {
  getSecretSummariesForLocation,
  vercelApiTokenStatus,
} from "@/lib/actions/integrations";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function IntegrationsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const [summaries, tokenConfigured] = await Promise.all([
    getSecretSummariesForLocation(loc.id),
    vercelApiTokenStatus(),
  ]);

  return (
    <div className="mt-6 space-y-6">
      <div className="max-w-2xl">
        <p className="text-sm text-zinc-500">
          Per-location secrets. Values are encrypted at rest with AES-256-GCM
          and never displayed after save. When{" "}
          <code className="font-mono">VERCEL_API_TOKEN</code> is configured on
          the dashboard, saves also push to the location&apos;s Vercel project
          env vars so the location site picks them up on next deploy.
        </p>
      </div>
      <IntegrationsForm
        location={loc}
        summaries={summaries}
        vercelTokenConfigured={tokenConfigured}
      />
    </div>
  );
}
