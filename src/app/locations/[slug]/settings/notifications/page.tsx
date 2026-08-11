import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { NotificationsForm } from "@/components/NotificationsForm";
import { updateNotifications } from "@/lib/actions/locations";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function NotificationsSettingsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const action = updateNotifications.bind(null, slug);

  return (
    <section>
      <div className="mb-2">
        <Link
          href={`/locations/${slug}/settings`}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Settings
        </Link>
      </div>
      <PageHeader
        title="Notifications"
        description="Transactional emails customers receive after booking. Branding, From name, and reply-to are pulled from this location's settings automatically."
      />
      <NotificationsForm
        action={action}
        initial={loc.confirmationEmailMessageMd ?? ""}
      />
    </section>
  );
}
