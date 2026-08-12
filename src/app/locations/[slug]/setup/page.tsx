import { notFound } from "next/navigation";
import { SetupTracker } from "@/components/SetupTracker";
import { getSetupItemsForLocation } from "@/lib/actions/setup";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function SetupPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const items = await getSetupItemsForLocation(loc.id);

  return (
    <div className="mt-6 space-y-6" data-tour="setup">
      <div className="max-w-2xl">
        <p className="text-sm text-zinc-500">
          Wall-clock-heavy external dependencies. Twilio A2P brand registration
          is the longest pole (1-2 weeks) — start it as early as possible. Each
          item: edit status / owner / expected date inline. Overdue items
          highlight red.
        </p>
      </div>

      <SetupTracker location={loc} items={items} />
    </div>
  );
}
