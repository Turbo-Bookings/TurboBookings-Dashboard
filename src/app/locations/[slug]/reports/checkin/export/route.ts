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
  const today = DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
  const range = resolveRange(
    { from: dayParam(url, "from", today), to: dayParam(url, "to", today) },
    tz,
    "today",
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
      r.status === "not_yet" ? "never marked" : r.status.replace("_", " "),
    ]),
  );
}
