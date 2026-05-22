import { notFound } from "next/navigation";
import { TrackingForm } from "@/components/TrackingForm";
import { getTrackingConfigForLocation } from "@/lib/actions/tracking";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function TrackingPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const config = await getTrackingConfigForLocation(loc.id);

  return (
    <div className="mt-6">
      <div className="mb-6 max-w-2xl">
        <p className="text-sm text-zinc-500">
          Per-location tracking IDs. Saved values become the source of truth
          for runtime config — a future bridge pushes them into each
          location&apos;s Vercel Edge Config so the live marketing site
          hot-updates without a redeploy. Until Miami + HTown are refactored
          to read from Edge Config, saves here are admin-only.
        </p>
      </div>
      <TrackingForm location={loc} config={config} />
    </div>
  );
}
