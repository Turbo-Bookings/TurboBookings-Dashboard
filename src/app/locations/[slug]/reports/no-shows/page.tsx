import { notFound } from "next/navigation";
import { CircleX, PhoneOff, TriangleAlert, TrendingUp } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { ReportShell } from "@/components/reports/ReportShell";
import { NoShowRows, type NoShowView } from "@/components/reports/NoShowRows";
import { reportByKey } from "@/lib/reports/registry";
import { resolveRange } from "@/lib/reports/range";
import { noShowReport } from "@/lib/data/reports";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";
import { usd } from "@/lib/ui/money";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
};

export default async function NoShowsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";

  // Last 7 days, not today. A call list should open with people to call: at 10am on a Tuesday
  // nothing has no-showed yet, so "today" is an empty screen for most of the working day — the same
  // trap the check-in report fell into. The team works recent no-shows, not this hour's.
  const range = resolveRange(sp, tz, "rolling7");
  const rows = await noShowReport(loc.id, range.from, range.to);
  const canLog = await can("manage_bookings", slug);

  const disputed = rows.filter((r) => r.disputed).length;
  const untouched = rows.filter((r) => r.followUpCount === 0).length;
  const wonBack = rows.filter((r) => r.latestStatus === "rescheduled").length;
  const unpaid = rows.reduce((s, r) => s + r.balanceDueCents, 0);

  const view: NoShowView[] = rows.map((r) => ({
    bookingId: r.bookingId,
    displayNumber: r.displayNumber,
    customerName: r.customerName,
    phone: r.phone,
    itemName: r.itemName,
    startsAtIso: r.startsAt.toISOString(),
    vehicles: r.vehicles,
    noShowUnits: r.noShowUnits,
    disputed: r.disputed,
    balanceDueCents: r.balanceDueCents,
    latest:
      r.latestStatus && r.latestAt
        ? {
            id: `${r.bookingId}-latest`,
            status: r.latestStatus,
            note: r.latestNote,
            createdAt: r.latestAt,
            byName: "",
          }
        : null,
    followUpCount: r.followUpCount,
  }));

  return (
    <ReportShell slug={slug} report={reportByKey("no-shows")!} range={range}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="No-shows" value={String(rows.length)} sub={`${usd(unpaid)} unpaid`} tone="orange" icon={CircleX} />
        <StatTile label="Not called yet" value={String(untouched)} sub="no follow-up logged" tone="violet" icon={PhoneOff} />
        <StatTile label="Won back" value={String(wonBack)} sub="rescheduled after outreach" tone="emerald" icon={TrendingUp} />
        <StatTile label="Disputed" value={String(disputed)} sub="some vehicles checked in" tone="zinc" icon={TriangleAlert} />
      </div>

      {/*
        The discrepancy cases, called out rather than left to be spotted. These are as likely to be
        our record being wrong as the customer not turning up, and phoning someone about a ride they
        actually took is the single worst outcome this list can produce.
      */}
      {disputed > 0 && (
        <p className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <strong>{disputed}</strong> booking{disputed === 1 ? " has" : "s have"} some vehicles
          checked in and others marked no-show. Check those before calling — they may have ridden.
        </p>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Call list
        <span className="ml-2 font-normal text-zinc-400">oldest tour first</span>
      </h3>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No no-shows in this range. If that looks wrong, check the Check-in report — bookings nobody
          marked either way do not count as no-shows and never appear here.
        </p>
      ) : (
        <NoShowRows slug={slug} rows={view} tz={tz} canLog={canLog} />
      )}
    </ReportShell>
  );
}
