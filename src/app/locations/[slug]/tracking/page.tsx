import { TabPlaceholder } from "@/components/TabPlaceholder";

export default function TrackingPage() {
  return (
    <TabPlaceholder
      name="Tracking"
      description="Meta pixel, GA4, GTM, Google Ads IDs. Hot-update via Edge Config. Mode-aware UI (direct / gtm_only / hybrid)."
      phase="Phase 1"
    />
  );
}
