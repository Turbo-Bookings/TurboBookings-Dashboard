import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ArrowLeft, Download, Percent, Wallet, Ticket } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { taxReport } from "@/lib/data/bookings";
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

export default async function TaxReportPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";
  const legalName = loc.brandLegalName || loc.brandDisplayName || "Your business";

  const today = DateTime.now().setZone(tz);
  const toKey = sp.to && DAY_RE.test(sp.to) ? sp.to : today.toFormat("yyyy-LL-dd");
  const fromKey =
    sp.from && DAY_RE.test(sp.from) ? sp.from : today.startOf("month").toFormat("yyyy-LL-dd");
  const from = DateTime.fromISO(fromKey, { zone: tz }).startOf("day").toUTC().toJSDate();
  const to = DateTime.fromISO(toKey, { zone: tz }).plus({ days: 1 }).startOf("day").toUTC().toJSDate();

  const r = await taxReport(loc.id, from, to);
  const base = `/locations/${slug}/reports/tax`;

  return (
    <section>
      <Link
        href={`/locations/${slug}/reports`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        <ArrowLeft className="h-4 w-4" /> Reports
      </Link>
      <PageHeader title="Sales tax collected" description={`Online deposits · by tour date · ${tz}`} />

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Tax collected online" value={usd(r.taxCollectedOnlineCents)} sub="on deposits, this range" tone="emerald" icon={Percent} />
        <StatTile label="Collected online" value={usd(r.collectedOnlineCents)} sub="total deposits charged" tone="amber" icon={Wallet} />
        <StatTile label="Bookings" value={String(r.bookings)} tone="violet" icon={Ticket} />
      </div>

      <div className="mt-5 rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <p className="font-semibold">Sales-tax remittance is your responsibility.</p>
        <p className="mt-1 leading-relaxed">
          This report shows only the sales tax TurboBookings collected online, on the deposits charged
          through us during this period. Any balance paid at the venue — and its tax — is collected and
          tracked by you, and is not included here. <span className="font-medium">{legalName}</span> is
          solely responsible for registering with the applicable tax authority and for filing and
          remitting all sales taxes. Provided for your convenience, not tax advice.
        </p>
      </div>

      <h3 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">By tour</h3>
      {r.byTour.length === 0 ? (
        <p className="text-sm text-zinc-500">No bookings in this range.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pl-1">Tour</th>
                <th className="py-2 text-right">Bookings</th>
                <th className="py-2 text-right">Collected online</th>
                <th className="py-2 pr-1 text-right">Tax collected</th>
              </tr>
            </thead>
            <tbody>
              {r.byTour.map((t) => (
                <tr key={t.name} className="border-b border-zinc-100 dark:border-zinc-800/50">
                  <td className="py-2 pl-1">{t.name}</td>
                  <td className="py-2 text-right">{t.bookings}</td>
                  <td className="py-2 text-right text-zinc-500">{usd(t.collectedCents)}</td>
                  <td className="py-2 pr-1 text-right font-medium">{usd(t.taxCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Active bookings only · by tour date. Reflects tax on the deposit paid online — not the full
        tour price. Balances collected at the venue are not included.
      </p>
    </section>
  );
}
