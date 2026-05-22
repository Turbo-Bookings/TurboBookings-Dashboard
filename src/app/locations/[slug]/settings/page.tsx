import { notFound } from "next/navigation";
import { SettingsPanel } from "@/components/SettingsPanel";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function SettingsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  return (
    <div className="mt-6">
      <SettingsPanel location={loc} />
    </div>
  );
}
