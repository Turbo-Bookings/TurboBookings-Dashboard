import { notFound } from "next/navigation";
import { DollarSign, Plus, Ticket, Truck } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { ReportShell } from "@/components/reports/ReportShell";
import { reportByKey } from "@/lib/reports/registry";
import { resolveRange } from "@/lib/reports/range";
import { salesByUser, upsellsByUser } from "@/lib/data/reports";
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
  const [rows, upsells] = await Promise.all([
    salesByUser(loc.id, range.from, range.to),
    upsellsByUser(loc.id, range.from, range.to),
  ]);
  const actors = await resolveUserLabels([
    ...rows.map((r) => r.userId),
    ...upsells.map((u) => u.userId),
  ]);
  const upsellTotal = upsells.reduce((s, u) => s + u.addedCents, 0);
  const upsellVehicles = upsells.reduce((s, u) => s + u.vehicles, 0);
  const unvalued = upsells.reduce((s, u) => s + u.unvalued, 0);

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
        Selling at the desk, which the booking-creator column cannot see. An addition raises an
        existing booking's subtotal, so it was being credited to whoever took the booking days
        earlier — or to nobody, when the booking came in online.
      */}
      <h3 className="mt-8 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Added at the desk
        <span className="ml-2 font-normal text-zinc-400">
          vehicles and riders added to bookings that already existed
        </span>
      </h3>

      {upsells.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing was added to an existing booking in this range.
        </p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Additions" value={String(upsells.reduce((s, u) => s + u.additions, 0))} tone="violet" icon={Plus} />
            <StatTile label="Vehicles added" value={String(upsellVehicles)} tone="blue" icon={Truck} />
            <StatTile label="Value added" value={usd(upsellTotal)} tone="emerald" icon={DollarSign} />
          </div>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-3 py-2 text-left font-medium">Person</th>
                  <th className="px-3 py-2 text-right font-medium">Additions</th>
                  <th className="px-3 py-2 text-right font-medium">Vehicles</th>
                  <th className="px-3 py-2 text-right font-medium">Value added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {upsells.map((u) => (
                  <tr key={u.userId ?? "unattributed"}>
                    <td className="px-3 py-2">
                      {u.userId ? labelFor(actors, u.userId).name : "Unattributed"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{u.additions}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{u.vehicles}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      {usd(u.addedCents)}
                      {u.unvalued > 0 && (
                        <span className="ml-1 font-normal text-zinc-400">+{u.unvalued} unvalued</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/*
        Additions before 2026-08-25 recorded a quantity but not a value. Counted separately rather
        than valued at zero — a silent zero would read as "sold nothing", which is the opposite of
        what happened.
      */}
      {unvalued > 0 && (
        <p className="mt-2 text-xs text-zinc-400">
          {unvalued} addition{unvalued === 1 ? "" : "s"} in this range predate the value being
          recorded (25 Aug 2026), so &ldquo;value added&rdquo; understates them. The vehicle counts
          are complete.
        </p>
      )}

      <p className="mt-4 text-xs text-zinc-400">
        Bookings are counted by who created them, on the date they were made. Additions are counted by
        who made the addition, on the date they made it.
      </p>
    </ReportShell>
  );
}
