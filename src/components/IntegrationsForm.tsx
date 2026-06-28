"use client";

import { SecretCard } from "@/components/SecretCard";
import { type SecretSummary } from "@/lib/actions/integrations";
import { INTEGRATION_SECRET_KINDS, type SecretKind } from "@/lib/integrations/catalog";
import type { Location } from "@/lib/db/schema";

type Props = {
  location: Location;
  summaries: Record<SecretKind, SecretSummary>;
  vercelTokenConfigured: boolean;
};

export function IntegrationsForm({
  location,
  summaries,
  vercelTokenConfigured,
}: Props) {
  return (
    <div className="space-y-6">
      {!vercelTokenConfigured && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-xs dark:border-amber-900 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-100">
            <code className="font-mono">VERCEL_API_TOKEN</code> not configured
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Secrets you save here are encrypted in the admin database but{" "}
            <em>not</em> pushed into the location&apos;s Vercel project env
            vars. Set <code className="font-mono">VERCEL_API_TOKEN</code> on
            the dashboard project (one of the operator follow-ups) to enable
            the auto-push.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {INTEGRATION_SECRET_KINDS.map((kind) => (
          <SecretCard
            key={kind}
            slug={location.slug}
            kind={kind}
            summary={summaries[kind]}
            vercelProjectLinked={!!location.vercelProjectId}
          />
        ))}
      </div>
    </div>
  );
}
