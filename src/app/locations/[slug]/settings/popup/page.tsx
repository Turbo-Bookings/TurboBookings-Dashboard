import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { PopupForm } from "@/components/PopupForm";
import { getPopupValues, updatePopup } from "@/lib/actions/popup";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function PopupSettingsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const action = updatePopup.bind(null, slug);
  const initial = await getPopupValues(slug);

  return (
    <section>
      <div className="mb-2">
        <Link href={`/locations/${slug}/settings`} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          <ChevronLeft className="h-3.5 w-3.5" /> Settings
        </Link>
      </div>
      <PageHeader
        title="Email popup"
        description="A signup popup on your marketing site — grows your email list and lifts ad match quality."
      />
      <PopupForm action={action} initial={initial} />
    </section>
  );
}
