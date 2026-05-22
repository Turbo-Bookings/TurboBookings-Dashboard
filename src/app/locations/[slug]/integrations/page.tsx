import { TabPlaceholder } from "@/components/TabPlaceholder";

export default function IntegrationsPage() {
  return (
    <TabPlaceholder
      name="Integrations"
      description="Per-location secrets — Meta CAPI token, Google Ads Conversion API, FareHarbor webhook secret. Encrypted in admin DB + provisioned into the location's Vercel env."
      phase="Phase 1"
    />
  );
}
