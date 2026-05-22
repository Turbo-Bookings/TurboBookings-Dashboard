import { notFound } from "next/navigation";
import { BrandingForm } from "@/components/BrandingForm";
import { MediaForm } from "@/components/MediaForm";
import { TourCatalogEditor } from "@/components/TourCatalogEditor";
import { VisualIdentityForm } from "@/components/VisualIdentityForm";
import { getAssetsForLocation } from "@/lib/actions/media";
import { getLocationBySlug } from "@/lib/data/locations";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BrandingPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const assetsByKind = await getAssetsForLocation(loc.id);

  return (
    <div className="mt-6 space-y-12">
      <BrandingForm location={loc} />

      <section>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <header className="md:col-span-1">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Visual identity
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Logo, brand colors, and typography. Colors are extracted from the
              logo on upload — pick primary + accent from the suggestions or
              enter hex codes manually.
            </p>
          </header>
          <div className="md:col-span-2">
            <VisualIdentityForm location={loc} />
          </div>
        </div>
      </section>

      <section>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
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

      <section>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <header className="md:col-span-1">
            <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Media
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Hero videos, gallery photos, OG image. All uploads go to Vercel
              Blob. Re-encode pipeline coming in Phase 1.4 — until then
              pre-encode hero videos with the ffmpeg recipe shown below.
            </p>
          </header>
          <div className="md:col-span-2">
            <MediaForm location={loc} assetsByKind={assetsByKind} />
          </div>
        </div>
      </section>
    </div>
  );
}
