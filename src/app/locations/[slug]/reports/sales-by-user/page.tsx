import { notFound } from "next/navigation";
import { DollarSign, Ticket, Truck } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { ReportShell } from "@/components/reports/ReportShell";
import { reportByKey } from "@/lib/reports/registry";
import { resolveRange } from "@/lib/reports/range";
import { salesByUser } from "@/lib/data/reports";
import { getLocationBySlug } from "@/lib/data/locations";
import { labelFor, resolveUserLabels } from "@/lib/users";
import { usd } from "@/lib/ui/money";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
};

export default async function SalesByUserPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";

  const range = resolveRange(sp, tz, "last30");
  const rows = await salesByUser(loc.id, range.from, range.to);
  const actors = await resolveUserLabels(rows.map((r) => r.userId));

  const staff = rows.filter((r) => r.userId !== null);
  const selfServe = rows.find((r) => r.userId === null);
  const staffSales = staff.reduce((s, r) => s + r.salesCents, 0);
  const staffBookings = staff.reduce((s, r) => s + r.bookings, 0);
  const staffVehicles = staff.reduce((s, r) => s + r.vehicles, 0);

  return (
    <ReportShell slug={slug} report={reportByKey("sales-by-user")!} range={range}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Booked by staff" value={String(staffBookings)} sub={`${staff.length} ${staff.length === 1 ? "person" : "people"}`} tone="violet" icon={Ticket} />
        <StatTile label="Vehicles" value={String(staffVehicles)} tone="blue" icon={Truck} />
        <StatTile label="Value" value={usd(staffSales)} sub="net of discounts" tone="emerald" icon={DollarSign} />
      </div>

      {/*
        Self-serve is a row, not a footnote. Without it a rep's share is a share of some unstated
        subset — and at these locations most volume is customers booking themselves, so the two
        framings differ by a lot.
      */}
      {selfServe && (
        <p className="mt-3 text-sm text-zinc-500">
          Customers booked <strong className="text-zinc-700 dark:text-zinc-200">{selfServe.bookings}</strong>{" "}
          more themselves online, worth {usd(selfServe.salesCents)}. Staff took{" "}
          {staffBookings + selfServe.bookings === 0
            ? "—"
            : `${Math.round((staffBookings / (staffBookings + selfServe.bookings)) * 100)}%`}{" "}
          of bookings in this range.
        </p>
      )}

      <h3 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">By person</h3>
      {staff.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No bookings were taken by staff in this range — everything came in online.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-3 py-2 text-left font-medium">Person</th>
                <th className="px-3 py-2 text-right font-medium">Bookings</th>
                <th className="px-3 py-2 text-right font-medium">Vehicles</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {staff.map((r) => (
                <tr key={r.userId ?? "self"}>
                  <td className="px-3 py-2">{labelFor(actors, r.userId).name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.bookings}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.vehicles}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{usd(r.salesCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Say what is NOT counted. Vehicles added at check-in are a real part of what the desk sells,
        and they live in the audit log rather than on the booking's creator — so counting them means
        a different query. Leaving that unsaid would let someone read this as the whole picture.
      */}
      <p className="mt-3 text-xs text-zinc-400">
        Counts bookings by who created them, on the date they were made. Vehicles added to an existing
        booking at check-in are not included here — they are recorded against the booking rather than
        the person, and are not attributed yet.
      </p>
    </ReportShell>
  );
}
