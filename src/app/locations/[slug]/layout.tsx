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
    getCapabilities(),
    currentUser(),
  ]);
  if (!loc) notFound();

  const seenV = Number(
    (user?.publicMetadata as { onboardingTourV?: number } | undefined)
      ?.onboardingTourV ?? 0,
  );
  const autoStart = seenV < TOUR_VERSION;

  return (
    <RoleGate>
      <TourProvider slug={loc.slug} caps={caps} autoStart={autoStart}>
        <LocationShell
          slug={loc.slug}
          brandName={loc.brandDisplayName ?? loc.slug}
          status={loc.status}
          locations={locations}
          caps={caps}
        >
          <CapabilitiesProvider caps={caps}>{children}</CapabilitiesProvider>
        </LocationShell>
      </TourProvider>
    </RoleGate>
  );
}
