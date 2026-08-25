import Link from "next/link";
import { usd } from "@/lib/ui/money";
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
  Truck,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatTile } from "@/components/ui/StatTile";
import {
  bookingsReport,
  bookingsTaken,
  collectedOnlineCash,
} from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";
import { BookingAlertsToggle } from "@/components/BookingAlertsToggle";

export const dynamic = "force-dynamic";


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
  const last7Start = now.minus({ days: 7 }).startOf("day").toUTC().toJSDate();
  // Three different questions, three different time bases. Keeping them apart
  // (and labelled) is the point of this layout: mixing "what is running" with
  // "what did we sell" and "what came in" in one unlabelled row is what made the
  // old dashboard misleading.
  //   toursX  — by TOUR date:    what is running / what to collect at the venue
  //   takenX  — by BOOKING date: sales activity
  //   cashX   — by PAYMENT date: money actually received
  const [toursToday, tours7, tours30, last7, takenToday, cashToday] = await Promise.all([
    bookingsReport(loc.id, todayStart, todayEnd),
    bookingsReport(loc.id, todayEnd, next7End),
    // Still 30 days, for "Top tours" only — a week is too short a window to rank tours against each
    // other without a single busy Saturday deciding the order.
    bookingsReport(loc.id, from, to),
    bookingsReport(loc.id, last7Start, todayStart),
    bookingsTaken(loc.id, todayStart, todayEnd),
    collectedOnlineCash(loc.id, todayStart, todayEnd),
  ]);
  // Aggregate money — the day's revenue, what the venue is holding, 30-day sales. Front-line staff
  // reach this page for the operational half (what is running today) and must not see any of it.
  // A booking's OWN balance stays visible to them elsewhere: they collect it.
  const showMoney = await can("view_revenue", slug);
  // Same bar as receiving alerts (director+), so the toggle is never shown to
  // someone the server would refuse to subscribe.
  const showAlerts = await can("manage_bookings", slug);
  const b = `/locations/${slug}`;

  // Each link is filtered by what the viewer can actually reach — a quick action that 404s is worse
  // than no quick action, and both of these now 404 for front-line staff.
  const quickLinks = [
    { label: "Open Manifest", href: `${b}/manifest`, icon: ClipboardList, show: true },
    { label: "New booking", href: `${b}/bookings/new`, icon: Plus, show: await can("manage_bookings", slug) },
    { label: "View Reports", href: `${b}/reports`, icon: ArrowRight, show: showMoney },
  ].filter((q) => q.show);

  return (
    <section>
      <PageHeader
        title="Dashboard"
        description={
          showMoney
            ? `${loc.brandDisplayName ?? loc.slug} · revenue over the last 30 days`
            : (loc.brandDisplayName ?? loc.slug)
        }
      />

      {/*
        Today first, and operational first. This page used to open on a 30-day revenue framing, which
        answers a question nobody standing at a venue is asking at 9am. What is running today and how
        many vehicles go out is the thing the whole day is planned around — and it is the half that
        front-line staff can see, so it leads.
      */}
      <Group title="Today at the venue" hint="What is running today, and how many vehicles go out.">
        <StatTile label="Bookings today" value={String(toursToday.bookings)} tone="blue" icon={CalendarDays} />
        <StatTile label="Vehicles out" value={String(toursToday.pax)} sub="across every tour" tone="violet" icon={Truck} />
        {showMoney && (
          <StatTile label="To collect today" value={usd(toursToday.balanceDueCents)} sub="at the venue" tone="orange" icon={Landmark} />
        )}
      </Group>

      {/* The breakdown the desk actually plans against — how many of each kind of machine. */}
      {toursToday.byTour.length > 0 && (
        <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">By tour, today</h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {toursToday.byTour.map((t) => (
              <li key={t.name} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="truncate">{t.name}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">
                  <span className="font-medium text-zinc-700 dark:text-zinc-200">{t.pax}</span>{" "}
                  vehicle{t.pax === 1 ? "" : "s"}
                  <span className="text-zinc-400">
                    {" · "}
                    {t.bookings} booking{t.bookings === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Sales, on the BOOKING date — how today's selling went, whenever those guests actually ride.
        Deliberately separate from the band above: mixing "what is running" with "what we sold" in one
        row is what made the old dashboard misleading, and the two rarely move together.
      */}
      {showMoney && (
        <Group title="Sales today" hint="Bookings MADE today, whatever date they ride.">
          <StatTile label="New bookings" value={String(takenToday.count)} sub={`${takenToday.onlineCount} online · ${takenToday.directCount} direct`} tone="violet" icon={Ticket} />
          <StatTile label="Vehicles booked" value={String(takenToday.pax)} tone="blue" icon={Truck} />
          <StatTile label="Revenue generated" value={usd(takenToday.salesCents)} sub="net of discounts, fees & tax" tone="emerald" icon={DollarSign} />
          <StatTile label="Collected online" value={usd(cashToday.netCents)} sub="net of refunds" tone="amber" icon={Wallet} />
        </Group>
      )}

      <Group title="Next 7 days" hint="Tours coming up, and what those guests still owe on arrival.">
        <StatTile label="Tours" value={String(tours7.bookings)} sub={`${tours7.pax} vehicles`} tone="blue" icon={CalendarClock} />
        {showMoney && (
          <StatTile label="To collect" value={usd(tours7.balanceDueCents)} sub="at the venue" tone="orange" icon={Landmark} />
        )}
      </Group>

      {/*
        Tours that have already RUN, in the seven days before today — today has its own band above,
        so including it would double-count the thing the venue is currently working through.

        Revenue is split by where the money came from rather than shown as one number, because those
        two halves behave differently: the online portion is settled and reconcilable in Stripe, and
        the venue portion is what guests owed on arrival. We have no record of cash actually changing
        hands — the desk can now take a card through the app, but cash is still a handshake — so it
        is labelled "due at the venue", not "collected". Calling it collected would state as fact
        something no system here has ever observed.
      */}
      {showMoney && (
        <Group title="Last 7 days" hint="Tours that ran in the week before today.">
          <StatTile label="Bookings" value={String(last7.bookings)} tone="blue" icon={CalendarClock} />
          <StatTile label="Vehicles out" value={String(last7.pax)} tone="violet" icon={Truck} />
          <StatTile label="Revenue generated" value={usd(last7.salesCents)} sub="deposits + venue balances" tone="emerald" icon={DollarSign} />
          <StatTile label="Deposits online" value={usd(last7.collectedCents)} sub={`${usd(last7.balanceDueCents)} due at the venue`} tone="amber" icon={Wallet} />
        </Group>
      )}

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
                    {t.pax} vehicles
                    {showMoney && (
                      <>
                        {" · "}
                        <span className="font-medium text-zinc-700 dark:text-zinc-200">{usd(t.salesCents)}</span>
                      </>
                    )}
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
