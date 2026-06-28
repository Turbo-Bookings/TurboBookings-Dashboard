import { notFound } from "next/navigation";
import { LocationShell } from "@/components/LocationShell";
import { getLocationBySlug, listLocationsForSwitcher } from "@/lib/data/locations";

type Props = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function LocationLayout({ children, params }: Props) {
  const { slug } = await params;
  const [loc, locations] = await Promise.all([
    getLocationBySlug(slug),
    listLocationsForSwitcher(),
  ]);
  if (!loc) notFound();

  return (
    <LocationShell
      slug={loc.slug}
      brandName={loc.brandDisplayName ?? loc.slug}
      status={loc.status}
      locations={locations}
    >
      {children}
    </LocationShell>
  );
}
