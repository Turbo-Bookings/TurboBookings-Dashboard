import { notFound } from "next/navigation";
import { DateTime } from "luxon";
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
  const base = `/locations/${slug}/bookings`;

  return (
    <section>
      <header className="mb-4">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Reports
        </h2>
        <p className="mt-1 text-sm text-zinc-500">By tour date · {tz}</p>
      </header>

      <form className="mb-5 flex flex-wrap items-end gap-2" action={`${base}/reports`}>
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
          href={`${base}/reports/export?from=${fromKey}&to=${toKey}`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Download CSV
        </a>
      </form>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Bookings" value={String(r.bookings)} />
        <Kpi label="Pax" value={String(r.pax)} />
        <Kpi label="Gross" value={usd(r.grossCents)} />
        <Kpi label="Collected online" value={usd(r.paidCents)} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Source: {r.onlineCount} online · {r.directCount} direct (active bookings only)
      </p>

      <h3 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">By tour</h3>
      {r.byTour.length === 0 ? (
        <p className="text-sm text-zinc-500">No bookings in this range.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <th className="py-2">Tour</th>
              <th className="py-2 text-right">Bookings</th>
              <th className="py-2 text-right">Pax</th>
              <th className="py-2 text-right">Gross</th>
            </tr>
          </thead>
          <tbody>
            {r.byTour.map((t) => (
              <tr key={t.name} className="border-b border-zinc-100 dark:border-zinc-800/50">
                <td className="py-2">{t.name}</td>
                <td className="py-2 text-right">{t.bookings}</td>
                <td className="py-2 text-right">{t.pax}</td>
                <td className="py-2 text-right">{usd(t.grossCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
    </div>
  );
}
