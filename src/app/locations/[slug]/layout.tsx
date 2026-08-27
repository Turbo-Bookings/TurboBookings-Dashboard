import { notFound } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { LocationShell } from "@/components/LocationShell";
import { CapabilitiesProvider } from "@/components/CapabilitiesProvider";
import { RoleGate } from "@/components/RoleGate";
import { TourProvider } from "@/components/tour/TourProvider";
import { TOUR_VERSION } from "@/components/tour/steps";
import { getLocationBySlug, listLocationsForSwitcher } from "@/lib/data/locations";
import { getCapabilities } from "@/lib/auth/roles";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function LocationLayout({ children, params }: Props) {
  const { slug } = await params;
  const [loc, locations, caps, user] = await Promise.all([
    getLocationBySlug(slug),
    listLocationsForSwitcher(),
    getCapabilities(slug),
    currentUser(),
  ]);
  if (!loc) notFound();

  const seenV = Number(
    (user?.publicMetadata as { onboardingTourV?: number } | undefined)
      ?.onboardingTourV ?? 0,
  );
  const autoStart = seenV < TOUR_VERSION;

  return (
    <RoleGate slug={loc.slug}>
      {/*
        The provider must wrap the SHELL, not just the page.
        It used to sit inside <LocationShell> around `{children}` alone — so the header, which holds
        the booking search, rendered OUTSIDE it. `useCaps()` there fell back to NO_CAPS (all false,
        the deliberate safe default), and every control gated on a capability silently vanished from
        any booking opened via search: reschedule, cancel/refund, message customer, editing vehicles,
        adding a rider. For EVERY user, including a master.
        It read as a per-booking bug because it depends on how you got there. The same booking opened
        from the manifest — inside the provider — has all its controls.
      */}
      <CapabilitiesProvider caps={caps}>
        <TourProvider slug={loc.slug} caps={caps} autoStart={autoStart}>
          <LocationShell
            slug={loc.slug}
            tz={loc.timezone ?? "America/Chicago"}
            brandName={loc.brandDisplayName ?? loc.slug}
            status={loc.status}
            locations={locations}
            caps={caps}
          >
            {children}
          </LocationShell>
        </TourProvider>
      </CapabilitiesProvider>
    </RoleGate>
  );
}
