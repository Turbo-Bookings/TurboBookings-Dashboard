import { TabPlaceholder } from "@/components/TabPlaceholder";

export default function DashboardPage() {
  return (
    <TabPlaceholder
      name="Dashboard"
      description="Per-location analytics: visits, bookings, revenue, clicks-to-call, email/SMS Klaviyo-style revenue attribution, marketing spend + ROMS. Fed by the event ingestion endpoint."
      phase="Phase 1.5"
    />
  );
}
