import { notFound } from "next/navigation";
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
    <div className="mt-6 space-y-6" data-tour="activity">
      <div className="max-w-2xl">
        <p className="text-sm text-zinc-500">
          Every config change to this location, newest first. Records who
          changed what and when. Phase 2 will add per-row revert; for now
          this is a read-only feed.
        </p>
      </div>

      <ActivityFeed entries={entries} tz={loc.timezone ?? "America/Chicago"} />
    </div>
  );
}
