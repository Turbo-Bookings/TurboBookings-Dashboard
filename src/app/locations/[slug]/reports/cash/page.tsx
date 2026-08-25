import { notFound } from "next/navigation";
import { Banknote, CreditCard, CircleHelp, CircleX } from "lucide-react";
import { StatTile } from "@/components/ui/StatTile";
import { ReportShell } from "@/components/reports/ReportShell";
import { reportByKey } from "@/lib/reports/registry";
import { resolveRange } from "@/lib/reports/range";
import { cashToCollect } from "@/lib/data/reports";
import { getLocationBySlug } from "@/lib/data/locations";
import { usd } from "@/lib/ui/money";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
};

export default async function CashReportPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();
  const tz = loc.timezone ?? "America/Chicago";

  // Defaults to today: this is what you count the till against at close.
  const range = resolveRange(sp, tz, "today");
  const r = await cashToCollect(loc.id, range.from, range.to);

  return (
    <ReportShell slug={slug} report={reportByKey("cash")!} range={range}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label="Cash to hand over"
          value={usd(r.cashExpectedCents)}
          sub="what the till should hold"
          tone="orange"
          icon={Banknote}
        />
        <StatTile
          label="Taken by card"
          value={usd(r.takenByCardCents)}
          sub={`${r.takenByCardBookings} booking${r.takenByCardBookings === 1 ? "" : "s"} at the desk`}
          tone="emerald"
          icon={CreditCard}
        />
        <StatTile
          label="Owed on arrival"
          value={usd(r.arrivedDueCents)}
          sub={`${r.arrivedBookings} booking${r.arrivedBookings === 1 ? "" : "s"} that showed up`}
          tone="blue"
          icon={CreditCard}
        />
      </div>

      {/*
        The arithmetic, written out. A reconciliation report whose numbers you have to reverse-
        engineer is one nobody trusts, and the whole point is to hand it to somebody counting a till.
      */}
      <div className="mt-4 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          How that adds up
        </h3>
        <dl className="space-y-1">
          <Line label="Owed by guests who arrived" cents={r.arrivedDueCents} />
          <Line label="Less: taken by card at the desk" cents={-r.takenByCardCents} />
          <Line label="Cash the venue should be holding" cents={r.cashExpectedCents} strong />
        </dl>
      </div>

      <h3 className="mt-6 mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        Not collectable
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          label="No-shows"
          value={usd(r.noShowDueCents)}
          sub={`${r.noShowBookings} booking${r.noShowBookings === 1 ? "" : "s"} · never arrived`}
          tone="zinc"
          icon={CircleX}
        />
        <StatTile
          label="Never marked"
          value={usd(r.notMarkedDueCents)}
          sub={`${r.notMarkedBookings} booking${r.notMarkedBookings === 1 ? "" : "s"} · status unknown`}
          tone="zinc"
          icon={CircleHelp}
        />
      </div>

      {/*
        Shown rather than hidden, because a day that will not balance is usually a day somebody
        forgot to mark — and dropping these rows removes the explanation along with the discrepancy.
      */}
      {r.notMarkedDueCents > 0 && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {usd(r.notMarkedDueCents)} sits on {r.notMarkedBookings} booking
          {r.notMarkedBookings === 1 ? "" : "s"} nobody marked as arrived or no-show. If the till is
          over, that is where the money came from; if it balances, those guests did not turn up.
          Marking them on the manifest resolves it either way.
        </p>
      )}
    </ReportShell>
  );
}

function Line({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        strong ? "border-t border-zinc-200 pt-1 font-semibold dark:border-zinc-700" : ""
      }`}
    >
      <dt className={strong ? "" : "text-zinc-500"}>{label}</dt>
      <dd className="tabular-nums">
        {cents < 0 ? `−${usd(-cents)}` : usd(cents)}
      </dd>
    </div>
  );
}
