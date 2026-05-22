import { notFound } from "next/navigation";
import { BrandingForm } from "@/components/BrandingForm";
import { TabPlaceholder } from "@/components/TabPlaceholder";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BrandingPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  return (
    <div className="mt-6">
      <BrandingForm location={loc} />

      <div className="mt-12 border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <TabPlaceholder
          name="Tour catalog, visual identity, media"
          description="Tour catalog (repeating section), logo + extracted color palette, font picker, hero videos + gallery photos + OG image. Landing in follow-up commits."
          phase="Phase 1"
        />
      </div>
    </div>
  );
}
