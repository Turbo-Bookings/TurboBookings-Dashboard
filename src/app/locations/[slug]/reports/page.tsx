import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { Download, Ticket, Users, DollarSign, Wallet, Landmark, Receipt, Percent, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { bookingsReport } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

export default async function ReportsPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";

  const today = DateTime.now().setZone(tz);
  const toKey = sp.to && DAY_RE.test(sp.to) ? sp.to : today.toFormat("yyyy-LL-dd");
  const fromKey =
    sp.from && DAY_RE.test(sp.from) ? sp.from : today.minus({ days: 30 }).toFormat("yyyy-LL-dd");
  const from = DateTime.fromISO(fromKey, { zone: tz }).startOf("day").toUTC().toJSDate();
  const to = DateTime.fromISO(toKey, { zone: tz }).plus({ days: 1 }).startOf("day").toUTC().toJSDate();

  const r = await bookingsReport(loc.id, from, to);
  const base = `/locations/${slug}/reports`;

  return (
    <section>
      <PageHeader title="Reports" description={`By tour date · ${tz}`} />

      <form className="mb-5 flex flex-wrap items-end gap-2" action={base}>
        <label className="text-sm">
          From
          <input type="date" name="from" defaultValue={fromKey} className="ml-2 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="text-sm">
          To
          <input type="date" name="to" defaultValue={toKey} className="ml-2 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          Apply
        </button>
        <a
          href={`${base}/export?from=${fromKey}&to=${toKey}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <Download className="h-4 w-4" /> CSV
        </a>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Bookings" value={String(r.bookings)} sub={`${r.onlineCount} online · ${r.directCount} direct`} tone="blue" icon={Ticket} />
        <StatTile label="Pax" value={String(r.pax)} tone="violet" icon={Users} />
        <StatTile label="Tour sales" value={usd(r.salesCents)} sub="net of discounts" tone="emerald" icon={DollarSign} />
        <StatTile label="Collected online" value={usd(r.collectedCents)} tone="amber" icon={Wallet} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Balance at venue" value={usd(r.balanceDueCents)} sub="left to collect" tone="orange" icon={Landmark} />
        <StatTile label="Processing fees" value={usd(r.feesCents)} tone="zinc" icon={Receipt} />
        <StatTile label="Tax (online)" value={usd(r.taxCents)} sub="on amount paid today" tone="zinc" icon={Percent} />
        <StatTile label="Refunded" value={usd(r.refundedCents)} tone="zinc" icon={RotateCcw} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Active bookings only · by tour date. Tour sales = charged total − processing fee − online tax.
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
                <th className="py-2 text-right">Pax</th>
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
    </section>
  );
}
