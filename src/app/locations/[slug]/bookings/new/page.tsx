import { notFound } from "next/navigation";
import { NewBookingForm } from "@/components/NewBookingForm";
import { PageHeader } from "@/components/ui/PageHeader";
import { getSlot } from "@/lib/data/availability";
import { listItemsForSelect } from "@/lib/data/items";
import { getLocationBySlug } from "@/lib/data/locations";
import { stripeConfigured, stripePublishableKey } from "@/lib/stripe/client";
import { requirePageCapability } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ item?: string; availability?: string }>;
};

export default async function NewBookingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  // The bookings subtree now opens at `checkin` so front-line staff can look bookings up. CREATING
  // one is still director+, so this page states it rather than relying on the layout it used to
  // inherit the restriction from.
  await requirePageCapability("manage_bookings", slug);
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";

  const items = await listItemsForSelect(loc.id);

  // Slot-scoped entry: lock the tour + time when launched from a manifest/grid slot.
  let lockedItem: { id: string; name: string } | undefined;
  let lockedSlot: { id: string; label: string } | undefined;
  if (sp.availability) {
    const slot = await getSlot(sp.availability, loc.id);
    if (slot) {
      const it = items.find((i) => i.id === slot.itemId);
      if (it) lockedItem = { id: it.id, name: it.name };
      lockedSlot = {
        id: slot.id,
        label: new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(slot.startsAt),
      };
    }
  } else if (sp.item) {
    const it = items.find((i) => i.id === sp.item);
    if (it) lockedItem = { id: it.id, name: it.name };
  }

  return (
    <section>
      <PageHeader
        title="New booking"
        description={
          lockedSlot
            ? "Booking into the selected slot. Charge a card now or take payment at the venue."
            : "Phone or walk-up booking. Charge a card now or take payment at the venue."
        }
      />

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Add a tour first (Tour Catalog → Tours).</p>
      ) : (
        <NewBookingForm
          slug={slug}
          tz={tz}
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
          lockedItem={lockedItem}
          lockedSlot={lockedSlot}
        />
      )}
    </section>
  );
}
