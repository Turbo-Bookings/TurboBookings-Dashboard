import { TabPlaceholder } from "@/components/TabPlaceholder";

export default function SetupPage() {
  return (
    <TabPlaceholder
      name="External Setup Tracker"
      description="Kanban / grouped checklist of wall-clock-heavy external dependencies: DNS, Meta domain verification, Twilio A2P, Resend domain, GSC, FareHarbor webhook, Vercel + Neon + Edge Config provisioning."
      phase="Phase 1"
    />
  );
}
