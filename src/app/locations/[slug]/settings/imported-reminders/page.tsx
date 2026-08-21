import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { ImportedRemindersPanel } from "@/components/ImportedRemindersPanel";
import { countImportedWithoutReminders } from "@/lib/actions/importedReminders";
import { can } from "@/lib/auth/roles";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

export default async function ImportedRemindersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  // Turbo-only: a one-time migration step, not an operator's daily task, and it
  // reaches hundreds of customers in one press.
  if (!(await can("manage_platform", slug))) notFound();

  const { pending } = await countImportedWithoutReminders(slug);

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
        title="Imported bookings"
        description="Schedule 24h and 2h reminders for bookings brought over from another system."
      />
      <div className="max-w-2xl">
        <ImportedRemindersPanel slug={slug} initialPending={pending} />
      </div>
    </section>
  );
}
