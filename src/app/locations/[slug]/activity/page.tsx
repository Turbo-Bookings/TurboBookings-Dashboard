import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActivityFeed } from "@/components/ActivityFeed";
import { listAuditForLocation } from "@/lib/audit";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function ActivityPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const entries = await listAuditForLocation(loc.id, 200);

  return (
    // Was a bare description with no heading, so the page opened on a paragraph floating under a
    // blank gap — nothing said what you were looking at. Uses the same PageHeader as every other
    // page rather than a bespoke one.
    <div className="space-y-6" data-tour="activity">
      <PageHeader
        title="Activity"
        description="Every change to this location, newest first — who changed what, and when."
      />

      <ActivityFeed entries={entries} tz={loc.timezone ?? "America/Chicago"} />
    </div>
  );
}
