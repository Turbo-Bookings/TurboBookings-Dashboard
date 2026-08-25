import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ArrowRight, CalendarSync, TrendingUp } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { ReportShell } from "@/components/reports/ReportShell";
import { reportByKey } from "@/lib/reports/registry";
import { resolveRange } from "@/lib/reports/range";
import { rescheduleReport } from "@/lib/data/reports";
import { getLocationBySlug } from "@/lib/data/locations";
import { labelFor, resolveUserLabels } from "@/lib/users";
import { usd } from "@/lib/ui/money";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
};

export default async function ReschedulesPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";

  const range = resolveRange(sp, tz, "rolling7");
  const rows = await rescheduleReport(loc.id, range.from, range.to);
  const actors = await resolveUserLabels(rows.map((r) => r.performedByUserId));

  const wins = rows.filter((r) => r.wasNoShow);
  const fees = rows.reduce((s, r) => s + r.feeChargedCents, 0);

  const when = (d: Date | null) =>
    d ? DateTime.fromJSDate(d).setZone(tz).toFormat("ccc, LLL d · h:mm a") : "—";

  return (
    <ReportShell slug={slug} report={reportByKey("reschedules")!} range={range}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Won back" value={String(wins.length)} sub="no-shows moved to a new slot" tone="emerald" icon={TrendingUp} />
        <StatTile label="Moves" value={String(rows.length)} sub="all reschedules" tone="blue" icon={CalendarSync} />
        <StatTile label="Fees charged" value={usd(fees)} sub="reschedule fees" tone="zinc" icon={CalendarSync} />
      </div>

      {/*
        Nothing before 2026-08-25 can be a win-back, and saying so is the difference between "we won
        nobody back last month" and "we did not record it last month". Check-in state was not
        captured on a move until migration 0038, so the 133 historical rows carry zeroes.
      */}
      <p className="mt-3 text-xs text-zinc-400">
        Win-backs are only identifiable from 25 Aug 2026, when a move started recording the booking&apos;s
        check-in state. Moves before then show as ordinary reschedules whether or not they were.
      </p>

      <h3 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Moves
        <span className="ml-2 font-normal text-zinc-400">win-backs first</span>
      </h3>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No bookings were moved in this range.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((r) => (
            <li key={r.id} className="p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link
                  href={`/locations/${slug}/bookings/${r.bookingId}`}
                  className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  #{r.displayNumber}
                </Link>
                <span className="text-sm font-medium">{r.customerName}</span>
                {r.wasNoShow && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                    <TrendingUp className="h-3 w-3" /> Won back from a no-show
                  </span>
                )}
                {r.wasDisputed && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
                    had partly checked in
                  </span>
                )}
                <span className="ml-auto text-xs text-zinc-400">
                  {labelFor(actors, r.performedByUserId).name} ·{" "}
                  <span className="tabular-nums">
                    {DateTime.fromJSDate(r.createdAt).setZone(tz).toFormat("LLL d, h:mm a")}
                  </span>
                </span>
              </div>

              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                <span className="tabular-nums">{when(r.fromStartsAt)}</span>
                {r.fromItemName && <span className="text-zinc-400">{r.fromItemName}</span>}
                <ArrowRight className="h-3 w-3 shrink-0 text-zinc-400" />
                <span className="tabular-nums font-medium text-zinc-700 dark:text-zinc-300">
                  {when(r.toStartsAt)}
                </span>
                {r.toItemName && <span className="text-zinc-400">{r.toItemName}</span>}
                {r.feeChargedCents > 0 && (
                  <span className="text-zinc-400">· fee {usd(r.feeChargedCents)}</span>
                )}
              </p>

              {r.reason && <p className="mt-0.5 text-xs text-zinc-500">{r.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </ReportShell>
  );
}
