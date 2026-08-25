import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { getLocationBySlug } from "@/lib/data/locations";
import { getCapabilities } from "@/lib/auth/roles";
import { basisLabel, visibleReports } from "@/lib/reports/registry";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

/**
 * The reports index.
 *
 * Rendered entirely from the registry, so a report that exists is reachable and a report that is not
 * listed does not exist as far as the product is concerned. Previously this page hand-linked two of
 * the three reports, the nav knew about none of them, and the dashboard had a third copy of the
 * link — so adding a report meant three edits and half-finishing it was invisible.
 */
export default async function ReportsIndexPage({ params }: Props) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const caps = await getCapabilities(slug);
  const reports = visibleReports(caps);
  const base = `/locations/${slug}/reports`;

  return (
    <section>
      <PageHeader
        title="Reports"
        description={`${loc.brandDisplayName ?? loc.slug} · ${loc.timezone ?? "America/Chicago"}`}
      />

      {reports.length === 0 ? (
        <p className="text-sm text-zinc-500">No reports are available for your role.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => {
            const Icon = r.icon;
            return (
              <Link
                key={r.key}
                href={`${base}/${r.key}`}
                className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-4 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-zinc-100 p-1.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {r.title}
                  </h2>
                  <ArrowRight className="ml-auto h-4 w-4 text-zinc-300 group-hover:text-zinc-500 dark:text-zinc-700" />
                </div>
                <p className="mt-2 text-sm text-zinc-500">{r.blurb}</p>
                {/* Which clock, on the card as well as inside — so the choice is informed before the
                    click rather than corrected after it. */}
                <p className="mt-2 text-xs text-zinc-400">{basisLabel(r.basis)}</p>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
