import { usd } from "@/lib/ui/money";
import { notFound } from "next/navigation";
import { Ticket, Truck, DollarSign, Wallet, Landmark, Percent, Receipt, RotateCcw } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { ReportShell } from "@/components/reports/ReportShell";
import { reportByKey } from "@/lib/reports/registry";
import { resolveRange } from "@/lib/reports/range";
import { bookingsReport } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
};

export default async function ReportsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";

  const range = resolveRange(sp, tz, "last30");
  const r = await bookingsReport(loc.id, range.from, range.to);
  // Platform processing fees are Turbo-internal revenue — only admins see them.
  const showFees = await can("manage_platform", slug);

  const report = reportByKey("revenue")!;

  return (
    <ReportShell slug={slug} report={report} range={range}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Bookings"
          value={String(r.bookings)}
          sub={
            `${r.onlineCount} online · ${r.directCount} direct` +
            (r.importedCount ? ` · ${r.importedCount} imported` : "")
          }
          tone="blue"
          icon={Ticket}
        />
        <StatTile label="Vehicles" value={String(r.pax)} tone="violet" icon={Truck} />
        <StatTile label="Tour sales" value={usd(r.salesCents)} sub="net of discounts" tone="emerald" icon={DollarSign} />
        <StatTile
          label="Collected online"
          value={usd(r.collectedCents)}
          sub={r.importedCount ? "excludes imported" : undefined}
          tone="amber"
          icon={Wallet}
        />
      </div>
      {r.importedCount > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Imported (pre-existing)"
            value={usd(r.importedCollectedCents)}
            sub={`${r.importedCount} booking${r.importedCount === 1 ? "" : "s"} · collected by the previous system`}
            tone="zinc"
            icon={Wallet}
          />
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Balance at venue" value={usd(r.balanceDueCents)} sub="left to collect" tone="orange" icon={Landmark} />
        {showFees && (
          <StatTile label="Processing fees" value={usd(r.feesCents)} tone="zinc" icon={Receipt} />
        )}
        <StatTile label="Tax (online)" value={usd(r.taxCents)} sub="on amount paid today" tone="zinc" icon={Percent} />
        <StatTile label="Refunded" value={usd(r.refundedCents)} tone="zinc" icon={RotateCcw} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Active bookings only · by tour date. Tour sales = collected online + balance at venue, net of online tax and fees.
      </p>

      <h3 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">By tour</h3>
      {r.byTour.length === 0 ? (
        <p className="text-sm text-zinc-500">No bookings in this range.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pl-1">Tour</th>
                <th className="py-2 text-right">Bookings</th>
                <th className="py-2 text-right">Vehicles</th>
                <th className="py-2 text-right">Sales</th>
                <th className="py-2 pr-1 text-right">Collected</th>
              </tr>
            </thead>
            <tbody>
              {r.byTour.map((t) => (
                <tr key={t.name} className="border-b border-zinc-100 dark:border-zinc-800/50">
                  <td className="py-2 pl-1">{t.name}</td>
                  <td className="py-2 text-right">{t.bookings}</td>
                  <td className="py-2 text-right">{t.pax}</td>
                  <td className="py-2 text-right">{usd(t.salesCents)}</td>
                  <td className="py-2 pr-1 text-right text-zinc-500">{usd(t.collectedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportShell>
  );
}
