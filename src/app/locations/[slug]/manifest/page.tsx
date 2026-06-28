import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CheckInControls } from "@/components/CheckInControls";
import { PageHeader } from "@/components/ui/PageHeader";
import { manifestForDate } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
};

export default async function ManifestPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { date } = await searchParams;
  const loc = await getLocationBySlug(slug);
  if (!loc) notFound();

  const tz = loc.timezone ?? "America/Chicago";
  const dateKey =
    date && DAY_RE.test(date) ? date : DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
  const day = DateTime.fromISO(dateKey, { zone: tz });
  const prev = day.minus({ days: 1 }).toFormat("yyyy-LL-dd");
  const next = day.plus({ days: 1 }).toFormat("yyyy-LL-dd");
  const today = DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");

  const slots = await manifestForDate(loc.id, dateKey, tz);
  const fmtTime = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  });
  const manifestBase = `/locations/${slug}/manifest`;
  const bookingsBase = `/locations/${slug}/bookings`;
  const linkCls =
    "inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <section>
      <PageHeader
        title={`Manifest — ${day.toFormat("cccc, LLL d")}`}
        description={`${slots.length} time slot${slots.length === 1 ? "" : "s"} · ${loc.timezone ?? "no timezone set"}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`${manifestBase}?date=${prev}`} className={linkCls}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Link>
            {dateKey !== today && (
              <Link href={`${manifestBase}?date=${today}`} className={linkCls}>
                Today
              </Link>
            )}
            <Link href={`${manifestBase}?date=${next}`} className={linkCls}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      {slots.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
          <p className="text-sm text-zinc-500">No availability on this day.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {slots.map((s) => (
            <div key={s.availabilityId}>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                  {fmtTime.format(s.startsAt)} · {s.itemName}
                </h3>
                <span className="text-xs text-zinc-500">
                  {s.capacityMode === "fixed" && s.baseCapacity != null
                    ? `${s.booked}/${s.baseCapacity} booked`
                    : `${s.booked} booked`}
                </span>
              </div>
              {s.bookings.length === 0 ? (
                <p className="rounded-md border border-zinc-200 px-4 py-3 text-xs text-zinc-400 dark:border-zinc-800">
                  No bookings.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                  {s.bookings.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                          <Link href={`${bookingsBase}/${b.id}`} className="hover:underline">
                            #{b.displayNumber}
                          </Link>{" "}
                          · {b.customerName}
                          {b.customerPhone ? (
                            <span className="text-zinc-400"> · {b.customerPhone}</span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {b.lines.map((l) => `${l.quantity} × ${l.ctName}`).join(", ")}
                          {b.balanceDueCents > 0 && (
                            <span className="ml-2 font-medium text-amber-600">
                              {usd(b.balanceDueCents)} due
                            </span>
                          )}
                        </p>
                      </div>
                      <CheckInControls slug={slug} bookingId={b.id} current={b.rollup} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
