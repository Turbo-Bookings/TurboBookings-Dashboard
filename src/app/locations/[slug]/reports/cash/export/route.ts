import { DateTime } from "luxon";
import { csvResponse, dayParam, guardExport } from "@/lib/csv";
import { cashToCollect } from "@/lib/data/reports";
import { resolveRange } from "@/lib/reports/range";

/**
 * The cash reconciliation, as a sheet somebody can sign.
 *
 * Rows rather than columns: this gets printed and counted against a till, and a single wide row of
 * figures is harder to check off than a short column you can run a finger down.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await guardExport(slug, "view_revenue");
  if (!guard.ok) return guard.response;
  const loc = guard.location;
  const tz = loc.timezone ?? "America/Chicago";

  const url = new URL(request.url);
  // Same default as the page — a CSV that covers a different range than the screen it was
  // downloaded from is worse than no CSV.
  const now = DateTime.now().setZone(tz);
  const range = resolveRange(
    {
      from: dayParam(url, "from", now.minus({ days: 6 }).toFormat("yyyy-LL-dd")),
      to: dayParam(url, "to", now.toFormat("yyyy-LL-dd")),
    },
    tz,
    "rolling7",
  );

  const r = await cashToCollect(loc.id, range.from, range.to);
  const money = (c: number) => (c / 100).toFixed(2);

  return csvResponse(
    `cash-to-collect-${range.fromKey}_${range.toKey}.csv`,
    ["Line", "Bookings", "Amount"],
    [
      ["Owed by guests who arrived", r.arrivedBookings, money(r.arrivedDueCents)],
      ["Less: taken by card at the desk", r.takenByCardBookings, money(-r.takenByCardCents || 0)],
      ["Cash the venue should be holding", "", money(r.cashExpectedCents)],
      ["", "", ""],
      ["Not collectable — no-shows", r.noShowBookings, money(r.noShowDueCents)],
      ["Not collectable — never marked", r.notMarkedBookings, money(r.notMarkedDueCents)],
    ],
  );
}
