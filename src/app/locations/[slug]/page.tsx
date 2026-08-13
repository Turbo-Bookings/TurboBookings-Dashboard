import { notFound, redirect } from "next/navigation";
import { BrandingForm } from "@/components/BrandingForm";
import { MediaForm } from "@/components/MediaForm";
import { TourCatalogEditor } from "@/components/TourCatalogEditor";
import { VisualIdentityForm } from "@/components/VisualIdentityForm";
import { getAssetsForLocation } from "@/lib/actions/media";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";

type Props = {
  params: Promise<{ slug: string }>;
};

export default async function BrandingPage({ params }: Props) {
  const { slug } = await params;
  // This root is a config (branding/media) surface. Send lower roles to the
  // highest landing they can access so the bare root is never a dead end.
  if (!(await can("manage_config", slug))) {
    if (await can("manage_bookings", slug)) redirect(`/locations/${slug}/dashboard`);
    redirect(`/locations/${slug}/manifest`);
  }
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  // FareHarbor-era locations (Miami/Houston) have a FareHarbor shortname and
  // sell FareHarbor items; custom-booking-system locations (e.g. DTown) don't —
  // their tours live in the native Tour Catalog. Only show the FareHarbor
  // tour-catalog section (and its FareHarbor-specific copy) for the former, so
  // new-system locations never see FareHarbor language here.
  const isFareharborLocation = Boolean(loc.fareharborShortname);

  const assetsByKind = await getAssetsForLocation(loc.id);

  return (
    <div className="mt-6 space-y-12">
      <div data-tour="branding">
        <BrandingForm location={loc} />
      </div>

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

      {isFareharborLocation && (
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
      )}

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
