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
import {
  bookingsReport,
  bookingsTaken,
  collectedOnlineCash,
  outstandingBalance,
} from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";
import { BookingAlertsToggle } from "@/components/BookingAlertsToggle";

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
  // Three different questions, three different time bases. Keeping them apart
  // (and labelled) is the point of this layout: mixing "what is running" with
  // "what did we sell" and "what came in" in one unlabelled row is what made the
  // old dashboard misleading.
  //   toursX  — by TOUR date:    what is running / what to collect at the venue
  //   takenX  — by BOOKING date: sales activity
  //   cashX   — by PAYMENT date: money actually received
  const [
    toursToday, tours7, tours30,
    takenToday, taken30,
    cashToday, cash30,
    outstanding,
  ] = await Promise.all([
    bookingsReport(loc.id, todayStart, todayEnd),
    bookingsReport(loc.id, todayEnd, next7End),
    bookingsReport(loc.id, from, to),
    bookingsTaken(loc.id, todayStart, todayEnd),
    bookingsTaken(loc.id, from, to),
    collectedOnlineCash(loc.id, todayStart, todayEnd),
    collectedOnlineCash(loc.id, from, to),
    // Everything still owed on tours that have not run yet — including the
    // migrated FareHarbor bookings, whose balances are still collected here.
    outstandingBalance(loc.id, todayStart),
  ]);
  // Platform processing fees are Turbo-internal revenue — only admins see them.
  const showFees = await can("manage_platform", slug);
  // Same bar as receiving alerts (director+), so the toggle is never shown to
  // someone the server would refuse to subscribe.
  const showAlerts = await can("manage_bookings", slug);
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

      <Group title="Today" hint="What is running at the venue today, and what came in today.">
        <StatTile label="Tours today" value={String(toursToday.bookings)} sub={`${toursToday.pax} pax`} tone="blue" icon={CalendarDays} />
        <StatTile label="To collect today" value={usd(toursToday.balanceDueCents)} sub="cash, at the venue" tone="orange" icon={Landmark} />
        <StatTile label="Booked today" value={String(takenToday.count)} sub={`${takenToday.onlineCount} online · ${takenToday.directCount} direct`} tone="violet" icon={Ticket} />
        <StatTile label="Collected today" value={usd(cashToday.netCents)} sub="online, net of refunds" tone="amber" icon={Wallet} />
      </Group>

      <Group title="Next 7 days" hint="Tours coming up, and what those guests still owe on arrival.">
        <StatTile label="Tours" value={String(tours7.bookings)} sub={`${tours7.pax} pax`} tone="blue" icon={CalendarClock} />
        <StatTile label="To collect" value={usd(tours7.balanceDueCents)} sub="cash, at the venue" tone="orange" icon={Landmark} />
      </Group>

      <Group title="Last 30 days" hint="Sales activity and money received. Bookings are counted when they were MADE.">
        <StatTile label="Bookings taken" value={String(taken30.count)} sub={`${taken30.onlineCount} online · ${taken30.directCount} direct`} tone="violet" icon={Ticket} />
        <StatTile label="Pax booked" value={String(taken30.pax)} tone="blue" icon={Users} />
        <StatTile label="Tour sales" value={usd(taken30.salesCents)} sub="net of discounts, fees & tax" tone="emerald" icon={DollarSign} />
        <StatTile label="Collected online" value={usd(cash30.netCents)} sub="net of refunds" tone="amber" icon={Wallet} />
      </Group>

      <Group title="Outstanding" hint="Everything still owed on tours that have not run yet — the real number to chase.">
        <StatTile
          label="Still to collect"
          value={usd(outstanding.balanceCents)}
          sub={`across ${outstanding.bookings} upcoming booking${outstanding.bookings === 1 ? "" : "s"}`}
          tone="orange"
          icon={Landmark}
        />
        {outstanding.importedBookings > 0 && (
          <StatTile
            label="…of which migrated"
            value={usd(outstanding.importedBalanceCents)}
            sub={`${outstanding.importedBookings} FareHarbor booking${outstanding.importedBookings === 1 ? "" : "s"}`}
            tone="zinc"
            icon={ClipboardList}
          />
        )}
        <StatTile
          label={showFees ? "Tax + platform fees (30d)" : "Tax collected (30d)"}
          value={usd(tours30.taxCents + (showFees ? tours30.feesCents : 0))}
          sub={showFees ? "tax + your 6%" : "pass-through tax"}
          tone="zinc"
          icon={Wallet}
        />
      </Group>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 lg:col-span-2 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">Top tours</h2>
          {tours30.byTour.length === 0 ? (
            <p className="text-sm text-zinc-500">No bookings in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {tours30.byTour.slice(0, 6).map((t) => (
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

        <div data-tour="dashboard-quick-actions" className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
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

      {showAlerts && <BookingAlertsToggle slug={slug} />}

      <p className="mt-6 text-xs text-zinc-400">
        Each section uses the time basis that matches its question, which is stated in its subtitle.
        “Top tours” is by tour date over 30 days. Deeper KPIs (payouts, YoY, conversion, marketing
        ROAS) land once the brains pipe is live.
      </p>
    </section>
  );
}

// A labelled band of tiles. The label and hint are the whole point: the previous
// dashboard put tiles on three different time bases side by side with nothing to
// distinguish them, so "Collected online" read $0 on a day with real sales and
// "Balance to collect" showed a fraction of what was actually owed.
function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5 first:mt-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</h2>
        <p className="text-xs text-zinc-400">{hint}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </div>
  );
}
