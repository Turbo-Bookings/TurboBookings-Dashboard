import { notFound } from "next/navigation";
import { LocationShell } from "@/components/LocationShell";
import { CapabilitiesProvider } from "@/components/CapabilitiesProvider";
import { getLocationBySlug, listLocationsForSwitcher } from "@/lib/data/locations";
import { getCapabilities } from "@/lib/auth/roles";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function LocationLayout({ children, params }: Props) {
  const { slug } = await params;
  const [loc, locations, caps] = await Promise.all([
    getLocationBySlug(slug),
    listLocationsForSwitcher(),
    getCapabilities(),
  ]);
  if (!loc) notFound();

  return (
    <LocationShell
      slug={loc.slug}
      brandName={loc.brandDisplayName ?? loc.slug}
      status={loc.status}
      locations={locations}
      caps={caps}
    >
      <CapabilitiesProvider caps={caps}>{children}</CapabilitiesProvider>
    </LocationShell>
  );
}
