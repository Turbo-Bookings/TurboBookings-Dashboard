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
      <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
        <strong>This is not lost money.</strong> The customer is still billed the fee — it is inside
        the balance they pay at check-in. What failed is only our ability to take it from their card
        automatically, so the cash goes to the operator and the operator ends up holding our share.
        Retry where a card exists; otherwise settle it with the operator and write it off here.
      </p>
      <UncollectedFees slug={slug} rows={rows} />
    </div>
  );
}
