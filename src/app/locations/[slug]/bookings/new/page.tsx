import { notFound } from "next/navigation";
import { NewBookingForm } from "@/components/NewBookingForm";
import { listItemsForSelect } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";
import { stripeConfigured, stripePublishableKey } from "@/lib/stripe/client";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function NewBookingPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const items = await listItemsForSelect(loc.id);

  return (
    <section>
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          New booking
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Phone or walk-up booking. Charge a card now or take payment at the venue.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Add a tour first (Catalog → Tours).</p>
      ) : (
        <NewBookingForm
          slug={slug}
          tz={loc.timezone ?? "America/Chicago"}
          items={items.map((i) => ({ id: i.id, name: i.name }))}
          location={{
            depositMode: loc.depositMode,
            depositAmountCents: loc.depositAmountCents,
            depositPercentBps: loc.depositPercentBps,
            platformFeeBps: loc.platformFeeBps,
            platformFeeMode: loc.platformFeeMode,
            taxRateBps: loc.taxRateBps,
            taxMode: loc.taxMode,
          }}
          publishableKey={stripePublishableKey()}
          stripeAccount={loc.stripeAccountId ?? null}
          configured={stripeConfigured()}
        />
      )}
    </section>
  );
}
