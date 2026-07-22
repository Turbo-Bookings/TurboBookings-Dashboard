import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ReviewsForm } from "@/components/ReviewsForm";
import { updateReviews } from "@/lib/actions/locations";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function ReviewsSettingsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const action = updateReviews.bind(null, slug);

  return (
    <section>
      <div className="mb-2">
        <Link href={`/locations/${slug}/settings`} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          <ChevronLeft className="h-3.5 w-3.5" /> Settings
        </Link>
      </div>
      <PageHeader
        title="Reviews"
        description="Google rating shown as social proof on the customer tour page and checkout."
      />
      <ReviewsForm
        action={action}
        initial={{
          rating: loc.googleRatingTenths != null ? String(loc.googleRatingTenths / 10) : "",
          count: loc.googleReviewCount != null ? String(loc.googleReviewCount) : "",
          url: loc.googleReviewsUrl ?? "",
        }}
      />
    </section>
  );
}
