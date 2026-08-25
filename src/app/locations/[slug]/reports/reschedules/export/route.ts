import { DateTime } from "luxon";
import { csvResponse, dayParam, guardExport } from "@/lib/csv";
import { rescheduleReport } from "@/lib/data/reports";
import { resolveRange } from "@/lib/reports/range";
import { labelFor, resolveUserLabels } from "@/lib/users";

/** Every move in the range, win-backs first. */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await guardExport(slug, "manage_bookings");
  if (!guard.ok) return guard.response;
  const loc = guard.location;
  const tz = loc.timezone ?? "America/Chicago";

  const url = new URL(request.url);
  const now = DateTime.now().setZone(tz);
  const range = resolveRange(
    {
      from: dayParam(url, "from", now.minus({ days: 6 }).toFormat("yyyy-LL-dd")),
      to: dayParam(url, "to", now.toFormat("yyyy-LL-dd")),
    },
    tz,
    "rolling7",
  );

  const rows = await rescheduleReport(loc.id, range.from, range.to);
  const actors = await resolveUserLabels(rows.map((r) => r.performedByUserId));
  const when = (d: Date | null) =>
    d ? DateTime.fromJSDate(d).setZone(tz).toFormat("ccc, LLL d yyyy · h:mm a") : "";

  return csvResponse(
    `reschedules-${range.fromKey}_${range.toKey}.csv`,
    [
      "Booking",
      "Customer",
      "Phone",
      "Win-back",
      "From",
      "From tour",
      "To",
      "To tour",
      "Moved by",
      "Moved at",
      "Fee",
      "Reason",
    ],
    rows.map((r) => [
      r.displayNumber,
      r.customerName,
      r.phone ?? "",
      r.wasNoShow ? (r.wasDisputed ? "YES — had partly checked in" : "YES") : "",
      when(r.fromStartsAt),
      r.fromItemName ?? "",
      when(r.toStartsAt),
      r.toItemName ?? "",
      labelFor(actors, r.performedByUserId).name,
      when(r.createdAt),
      (r.feeChargedCents / 100).toFixed(2),
      r.reason ?? "",
    ]),
  );
}
