import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { TaxesFeesForm } from "@/components/TaxesFeesForm";
import { updateTaxesFees } from "@/lib/actions/pricing";
import { can } from "@/lib/auth/roles";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

function pctStr(bps: number): string {
  return bps ? String(bps / 100) : "";
}

type Props = { params: Promise<{ slug: string }> };

export default async function TaxesFeesPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const action = updateTaxesFees.bind(null, slug);
  const showFee = await can("manage_platform", slug);

  return (
    <section>
      <div className="mb-2">
        <Link href={`/locations/${slug}/settings`} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          <ChevronLeft className="h-3.5 w-3.5" /> Settings
        </Link>
      </div>
      <PageHeader
        title="Taxes & Fees"
        description="Tax rate, processing fee, and deposit for this market. Reflects on the operator booking form and the customer booking flow."
      />
      <TaxesFeesForm
        action={action}
        showFee={showFee}
        initial={{
          taxRatePct: pctStr(loc.taxRateBps),
          taxMode: loc.taxMode,
          platformFeePct: pctStr(loc.platformFeeBps),
          platformFeeMode: loc.platformFeeMode,
          depositMode: loc.depositMode,
          depositAmount: loc.depositAmountCents != null ? String(loc.depositAmountCents / 100) : "",
          depositPercent: loc.depositPercentBps != null ? String(loc.depositPercentBps / 100) : "",
          venueFeeAmount: loc.venueFeePerPersonCents ? String(loc.venueFeePerPersonCents / 100) : "",
          venueFeeLabel: loc.venueFeeLabel ?? "",
          venueFeeInPlatformFeeBase: loc.venueFeeInPlatformFeeBase,
        }}
      />
    </section>
  );
}
