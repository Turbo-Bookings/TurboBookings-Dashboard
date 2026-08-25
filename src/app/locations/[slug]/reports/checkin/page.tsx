import { notFound } from "next/navigation";
import { CircleCheck, CircleHelp, CircleX, Truck } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { ReportShell } from "@/components/reports/ReportShell";
import { reportByKey } from "@/lib/reports/registry";
import { resolveRange } from "@/lib/reports/range";
import { checkInReport } from "@/lib/data/reports";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
};

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

export default async function CheckInReportPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";

  // Defaults to today: this is the report the desk pulls about the day it just worked.
  const range = resolveRange(sp, tz, "today");
  const r = await checkInReport(loc.id, range.from, range.to);
  const t = r.totals;

  return (
    <ReportShell slug={slug} report={reportByKey("checkin")!} range={range}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Vehicles booked" value={String(t.vehicles)} sub={`${t.bookings} bookings`} tone="blue" icon={Truck} />
        <StatTile label="Checked in" value={String(t.checkedIn)} sub={pct(t.checkedIn, t.vehicles)} tone="emerald" icon={CircleCheck} />
        <StatTile label="No-show" value={String(t.noShow)} sub={pct(t.noShow, t.vehicles)} tone="orange" icon={CircleX} />
        <StatTile label="Never marked" value={String(t.notMarked)} sub={pct(t.notMarked, t.vehicles)} tone="zinc" icon={CircleHelp} />
      </div>

      {/*
        The one number that decides whether the other two mean anything. A no-show rate computed over
        only the bookings somebody remembered to touch is a rate over an unknown denominator — if a
        third of the day was never marked, the rate looks entirely reasonable and is worthless.
      */}
      {t.notMarked > 0 && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>{t.notMarked}</strong> of {t.vehicles} vehicles were never marked either way, so
          the check-in and no-show rates above cover only {pct(t.vehicles - t.notMarked, t.vehicles)}{" "}
          of the range. Treat them as a floor, not a rate.
        </p>
      )}

      {r.partialBookings > 0 && (
        <p className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          <strong>{r.partialBookings}</strong> booking{r.partialBookings === 1 ? " has" : "s have"}{" "}
          some vehicles checked in and others marked no-show. Usually a party that turned up short —
          worth confirming before anyone is chased about a missed ride.
        </p>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">By tour</h3>
      {r.byTour.length === 0 ? (
        <p className="text-sm text-zinc-500">No bookings in this range.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-3 py-2 text-left font-medium">Tour</th>
                <th className="px-3 py-2 text-right font-medium">Bookings</th>
                <th className="px-3 py-2 text-right font-medium">Vehicles</th>
                <th className="px-3 py-2 text-right font-medium">Checked in</th>
                <th className="px-3 py-2 text-right font-medium">No-show</th>
                <th className="px-3 py-2 text-right font-medium">Never marked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {r.byTour.map((row) => (
                <tr key={row.itemName}>
                  <td className="px-3 py-2">{row.itemName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.bookings}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.vehicles}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {row.checkedIn}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-orange-600 dark:text-orange-400">
                    {row.noShow}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{row.notMarked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportShell>
  );
}
