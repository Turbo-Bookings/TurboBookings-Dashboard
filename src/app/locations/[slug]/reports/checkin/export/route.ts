import { DateTime } from "luxon";
import { csvResponse, dayParam, guardExport } from "@/lib/csv";
import { checkInRowsForCsv } from "@/lib/data/reports";
import { resolveRange } from "@/lib/reports/range";

/**
 * One row per booking, with what happened to it.
 *
 * `checkin` rather than `view_revenue`: this carries no money, and the desk is who needs it — it is
 * the one export front-line staff can pull.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await guardExport(slug, "checkin");
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

  const rows = await checkInRowsForCsv(loc.id, range.from, range.to);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return csvResponse(
    `check-in-${range.fromKey}_${range.toKey}.csv`,
    ["Booking", "Tour", "When", "Vehicles", "Checked in", "No-show", "Status"],
    rows.map((r) => [
      r.displayNumber,
      r.itemName,
      fmt.format(r.startsAt),
      r.vehicles,
      r.checkedIn,
      r.noShow,
      // "not_yet" is the honest label — nobody marked it, which is not the same as "did not arrive".
      // "never marked" only if the tour has actually run — otherwise it has simply not happened.
      r.status === "not_yet"
        ? r.startsAt.getTime() > Date.now()
          ? "not run yet"
          : "never marked"
        : r.status.replace("_", " "),
    ]),
  );
}
