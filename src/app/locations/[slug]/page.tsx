import { notFound } from "next/navigation";
import { BrandingForm } from "@/components/BrandingForm";
import { TabPlaceholder } from "@/components/TabPlaceholder";
import { TourCatalogEditor } from "@/components/TourCatalogEditor";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BrandingPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  return (
    <div className="mt-6 space-y-12">
      <BrandingForm location={loc} />

      <section>
        <div className="mb-4 grid grid-cols-1 gap-6 md:grid-cols-3">
          <header className="md:col-span-1">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Tour catalog
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              The FareHarbor items this location sells. Used to generate booking
              links and the pricing UI on the marketing site.
            </p>
          </header>
          <div className="md:col-span-2">
            <TourCatalogEditor location={loc} />
          </div>
        </div>
      </section>

      <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <TabPlaceholder
          name="Visual identity + media"
          description="Logo + extracted color palette, font picker, hero videos + gallery photos + OG image. Landing in follow-up commits."
          phase="Phase 1"
        />
      </div>
    </div>
  );
}
