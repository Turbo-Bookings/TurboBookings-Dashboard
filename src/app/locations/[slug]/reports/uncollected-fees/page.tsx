import { notFound } from "next/navigation";
import { UncollectedFees } from "@/components/UncollectedFees";
import { getUncollectedFees } from "@/lib/actions/uncollectedFees";
import { getLocationBySlug } from "@/lib/data/locations";
import { requirePageCapability } from "@/lib/auth/roles";

type Props = { params: Promise<{ slug: string }> };

export default async function UncollectedFeesPage({ params }: Props) {
  const { slug } = await params;
  // Turbo Bookings' own revenue, not the operator's — admin+ only.
  await requirePageCapability("manage_platform", slug);
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const rows = await getUncollectedFees(slug);

  return (
    <div className="mt-6 max-w-3xl">
      <h2 className="text-lg font-semibold tracking-tight">Uncollected platform fees</h2>
      <p className="mt-1 text-sm text-zinc-500">
        When a booking&apos;s value rises after checkout — a reschedule to a pricier tour, or an ATV
        added at check-in — our 6% rises with it. The original card charge has already settled and
        cannot be amended, so the difference is charged separately to the customer&apos;s saved card.
        These are the ones that could not be charged.
      </p>
      <UncollectedFees slug={slug} rows={rows} />
    </div>
  );
}
