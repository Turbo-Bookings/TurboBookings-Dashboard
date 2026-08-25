import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { UncollectedFees } from "@/components/UncollectedFees";
import { getUncollectedFees } from "@/lib/actions/uncollectedFees";
import { getLocationBySlug } from "@/lib/data/locations";
import { requirePageCapability } from "@/lib/auth/roles";
import { retainerWillCollect } from "@/lib/billing/operatorRecovery";

type Props = { params: Promise<{ slug: string }> };

export default async function UncollectedFeesPage({ params }: Props) {
  const { slug } = await params;
  // Turbo Bookings' own revenue, not the operator's — admin+ only.
  await requirePageCapability("manage_platform", slug);
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const rows = await getUncollectedFees(slug);
  // A pending invoice item is only collected when Stripe next invoices that customer. Without a live
  // retainer there is no next invoice, and "billed to the operator" would quietly mean "recorded and
  // going nowhere".
  const retainerActive = retainerWillCollect(loc);

  return (
    <div className="max-w-3xl">
      {/* Reachable from the reports index now, so it needs a way back like every other report. */}
      <Link
        href={`/locations/${slug}/reports`}
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All reports
      </Link>
      <h2 className="text-lg font-semibold tracking-tight">Uncollected platform fees</h2>
      <p className="mt-1 text-sm text-zinc-500">
        When a booking&apos;s value rises after checkout — a reschedule to a pricier tour, or an ATV
        added at check-in — our 6% rises with it. The original card charge has already settled and
        cannot be amended, so the difference is charged separately to the customer&apos;s saved card.
        These are the ones that could not be charged.
      </p>
      <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
        <strong>This is not lost money.</strong> The fee is inside the balance the customer pays at
        the venue. What failed is only our ability to take it from their card automatically. So the
        question is just <em>who</em> pays it — and the tour date decides: before it, the customer
        still owes the balance and a retry collects our share; after it, the operator has already
        taken that balance in cash, and charging the card would bill the same money twice.
      </p>
      <UncollectedFees
        slug={slug}
        rows={rows}
        retainerActive={retainerActive}
        tz={loc.timezone ?? "America/Chicago"}
      />
    </div>
  );
}
