import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { BillingForm } from "@/components/BillingForm";
import { getRetainerValues, updateRetainer } from "@/lib/actions/billing";
import { can } from "@/lib/auth/roles";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function BillingSettingsPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const action = updateRetainer.bind(null, slug);
  const initial = await getRetainerValues(slug);
  const canManage = await can("manage_platform", slug);

  return (
    <section>
      <div className="mb-2">
        <Link href={`/locations/${slug}/settings`} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          <ChevronLeft className="h-3.5 w-3.5" /> Settings
        </Link>
      </div>
      <PageHeader
        title="Billing & Retainer"
        description="Your monthly management retainer — save a card on file; it's charged automatically each month."
      />
      <BillingForm slug={slug} action={action} initial={initial} canManage={canManage} />
    </section>
  );
}
