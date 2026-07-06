import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  DollarSign,
  Landmark,
  Plus,
  Ticket,
  Users,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import { bookingsReport } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";
  const now = DateTime.now().setZone(tz);
  const from = now.minus({ days: 30 }).startOf("day").toUTC().toJSDate();
  const to = now.plus({ days: 1 }).startOf("day").toUTC().toJSDate();
  const todayStart = now.startOf("day").toUTC().toJSDate();
  const todayEnd = now.plus({ days: 1 }).startOf("day").toUTC().toJSDate();
  const next7End = now.plus({ days: 7 }).startOf("day").toUTC().toJSDate();
  const [r, today30, upcoming7] = await Promise.all([
    bookingsReport(loc.id, from, to),
    bookingsReport(loc.id, todayStart, todayEnd),
    bookingsReport(loc.id, todayEnd, next7End),
  ]);
  const b = `/locations/${slug}`;

  const quickLinks = [
    { label: "Open Manifest", href: `${b}/manifest`, icon: ClipboardList },
    { label: "New booking", href: `${b}/bookings/new`, icon: Plus },
    { label: "View Reports", href: `${b}/reports`, icon: ArrowRight },
  ];

  return (
    <section>
      <PageHeader
        title="Dashboard"
        description={`${loc.brandDisplayName ?? loc.slug} · revenue over the last 30 days`}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Bookings" value={String(r.bookings)} sub={`${r.onlineCount} online · ${r.directCount} direct`} tone="blue" icon={Ticket} />
        <StatTile label="Pax" value={String(r.pax)} tone="violet" icon={Users} />
        <StatTile label="Tour sales" value={usd(r.salesCents)} sub="net of discounts" tone="emerald" icon={DollarSign} />
        <StatTile label="Collected online" value={usd(r.collectedCents)} tone="amber" icon={Wallet} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Today" value={String(today30.bookings)} sub={`${today30.pax} pax`} tone="blue" icon={CalendarDays} />
        <StatTile label="Next 7 days" value={String(upcoming7.bookings)} sub={`${upcoming7.pax} pax`} tone="violet" icon={CalendarClock} />
        <StatTile label="Balance to collect" value={usd(r.balanceDueCents)} sub="at venue (30d)" tone="orange" icon={Landmark} />
        <StatTile label="Tax + fees (30d)" value={usd(r.taxCents + r.feesCents)} tone="zinc" icon={Wallet} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Top tours</h2>
          {r.byTour.length === 0 ? (
            <p className="text-sm text-zinc-500">No bookings in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {r.byTour.slice(0, 6).map((t) => (
                <li key={t.name} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate">{t.name}</span>
                  <span className="text-zinc-500">
                    {t.pax} pax ·{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-200">{usd(t.salesCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Quick actions</h2>
          <div className="flex flex-col gap-2">
            {quickLinks.map((q) => {
              const Icon = q.icon;
              return (
                <Link
                  key={q.label}
                  href={q.href}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-800 dark:text-zinc-200 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
                >
                  <Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  {q.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-6 text-xs text-zinc-400">
        Revenue is by tour date, active bookings. Tour sales exclude processing fees and pass-through tax.
        Deeper KPIs (payouts, YoY, conversion, marketing ROAS) land once the brains pipe is live.
      </p>
    </section>
  );
}
