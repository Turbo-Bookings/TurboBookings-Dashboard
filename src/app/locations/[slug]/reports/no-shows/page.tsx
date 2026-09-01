import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleX, PhoneOff, TriangleAlert, TrendingUp } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { ReportShell } from "@/components/reports/ReportShell";
import { NoShowRows, type NoShowView } from "@/components/reports/NoShowRows";
import { reportByKey } from "@/lib/reports/registry";
import { resolveRange } from "@/lib/reports/range";
import { noShowReport } from "@/lib/data/reports";
import { labelFor, resolveUserLabels } from "@/lib/users";
import { getLocationBySlug } from "@/lib/data/locations";
import { can } from "@/lib/auth/roles";
import { usd } from "@/lib/ui/money";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; preset?: string; state?: string }>;
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
  const rows = await noShowReport(loc.id, range.from, range.to, tz);
  const canLog = await can("manage_bookings", slug);

  // Filter tabs. "Open" is the default because the list exists to be worked: closed cases are kept
  // and reachable, not deleted, but they are not what a rep should see first. Houston has 25
  // `deposit_forfeited` bookings that have been sitting in the queue with nothing to do about them.
  const state = ["open", "due", "overdue", "won", "closed", "all"].includes(sp.state ?? "")
    ? (sp.state as string)
    : "open";
  const open = rows.filter((r) => !r.caseState.isClosed);
  const dueToday = rows.filter((r) => r.caseState.bucket === "due_today");
  const overdue = rows.filter((r) => r.caseState.bucket === "overdue");
  const closed = rows.filter(
    (r) => r.caseState.isClosed && r.caseState.outcome !== "won_back",
  );
  const shown =
    state === "all"
      ? rows
      : state === "due"
        ? dueToday
        : state === "overdue"
          ? overdue
          : state === "won"
            ? rows.filter((r) => r.caseState.outcome === "won_back")
            : state === "closed"
              ? closed
              : open;
  const disputed = open.filter((r) => r.disputed).length;
  const untouched = open.filter((r) => r.caseState.bucket === "new").length;
  // Derived from the MOVE, not from a rep remembering to pick "Rescheduled" from a dropdown. That
  // old rule reported 2 against a real 14 for this window, because performing the reschedule zeroes
  // no_show_units and the win-back then failed this report's own predicate. See `winBacks`.
  const wonBack = rows.filter((r) => r.outcome === "won_back").length;
  // Money still owed is a question about people still to chase, so it excludes the wins.
  const unpaid = open.reduce((s, r) => s + r.balanceDueCents, 0);

  // Who logged the latest outcome. This page hardcoded an empty author, so the call list has never
  // shown who worked it — the one thing that tells a manager whether the list is being worked.
  const actors = await resolveUserLabels(rows.map((r) => r.latestByUserId));

  const tab = (key: string, label: string, n: number) => {
    const qs = new URLSearchParams();
    if (sp.from) qs.set("from", sp.from);
    if (sp.to) qs.set("to", sp.to);
    if (sp.preset) qs.set("preset", sp.preset);
    if (key !== "open") qs.set("state", key);
    const on = state === key;
    return (
      <Link
        key={key}
        href={`?${qs.toString()}`}
        className={`rounded-md px-3 py-1.5 text-sm font-medium ${
          on
            ? "bg-blue-600 text-white"
            : "border border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        }`}
      >
        {label} <span className={on ? "text-white/70" : "text-zinc-400"}>{n}</span>
      </Link>
    );
  };

  const view: NoShowView[] = shown.map((r) => ({
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
            byName: labelFor(actors, r.latestByUserId).name,
          }
        : null,
    followUpCount: r.followUpCount,
    outcome: r.outcome,
    wonBackToIso: r.wonBackTo?.startsAt?.toISOString() ?? null,
    wonBackToItemName: r.wonBackTo?.itemName ?? null,
    caseOutcome: r.caseState.outcome,
    bucket: r.caseState.bucket,
    attempts: r.caseState.attempts,
    nextFollowUpAtIso: r.caseState.nextFollowUpAt?.toISOString() ?? null,
    caseState_isClosed: r.caseState.isClosed,
  }));

  return (
    <ReportShell slug={slug} report={reportByKey("no-shows")!} range={range}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Still to chase" value={String(open.length)} sub={`${usd(unpaid)} unpaid`} tone="orange" icon={CircleX} />
        <StatTile label="Not called yet" value={String(untouched)} sub="no follow-up logged" tone="violet" icon={PhoneOff} />
        <StatTile label="Won back" value={String(wonBack)} sub="moved to a new slot" tone="emerald" icon={TrendingUp} />
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

      <div className="mt-6 flex flex-wrap gap-2">
        {tab("open", "To chase", open.length)}
        {tab("overdue", "Overdue", overdue.length)}
        {tab("due", "Due today", dueToday.length)}
        {tab("won", "Won back", wonBack)}
        {tab("closed", "Closed", closed.length)}
        {tab("all", "All", rows.length)}
      </div>

      <h3 className="mt-4 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Call list
        <span className="ml-2 font-normal text-zinc-400">
          overdue first, then today, then never called — first call due on the no-show, then every
          24h for up to 3 attempts
        </span>
      </h3>

      {shown.length === 0 ? (
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
