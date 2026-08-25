import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { basisLabel, type ReportDef } from "@/lib/reports/registry";
import { PRESETS, type ResolvedRange } from "@/lib/reports/range";

/**
 * The frame every report sits in: a way back, the range being shown, which clock it runs on, and the
 * CSV.
 *
 * Shared so those four things cannot quietly differ between reports — in particular the time basis,
 * which is stated on every page rather than assumed. "Sales this week" is three different numbers
 * depending on whether you count when a booking was made, when the tour runs, or when the money
 * arrived, and a reader who picks the wrong one gets a confident wrong answer with no signal.
 *
 * Presets are plain links, not a client component: they are just a different URL, and keeping them
 * server-rendered means no hydration and no JS between clicking a range and seeing it.
 */
export function ReportShell({
  slug,
  report,
  range,
  children,
}: {
  slug: string;
  report: ReportDef;
  range: ResolvedRange;
  children: React.ReactNode;
}) {
  const base = `/locations/${slug}/reports`;
  const self = `${base}/${report.key}`;
  const qs = `from=${range.fromKey}&to=${range.toKey}`;

  return (
    <section>
      <Link
        href={base}
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All reports
      </Link>

      <PageHeader
        title={report.title}
        description={`${range.label} · ${basisLabel(report.basis)}`}
        actions={
          report.csv ? (
            <a
              href={`${self}/export?${qs}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              <Download className="h-4 w-4" /> CSV
            </a>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-2">
        <form className="flex flex-wrap items-end gap-2" action={self}>
          <label className="text-sm">
            From
            <input
              type="date"
              name="from"
              defaultValue={range.fromKey}
              className="ml-2 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="text-sm">
            To
            <input
              type="date"
              name="to"
              defaultValue={range.toKey}
              className="ml-2 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            Apply
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <Link
              key={p.key}
              href={`${self}?preset=${p.key}`}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      {children}
    </section>
  );
}
