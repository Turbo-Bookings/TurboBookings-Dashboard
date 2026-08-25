import { DateTime } from "luxon";
import { csvResponse, dayParam, guardExport } from "@/lib/csv";
import { noShowReport } from "@/lib/data/reports";
import { resolveRange } from "@/lib/reports/range";
import { followupLabel } from "@/lib/booking/followupStatus";

/**
 * The call list, as a sheet — for handing to whoever is working the phones off-screen.
 *
 * Carries the phone number and the original tour date and time, because those are what a rep needs
 * to say out loud. The disputed flag is a column of its own rather than a footnote: those rows should
 * be checked before anyone is called.
 */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await guardExport(slug, "manage_bookings");
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

  const rows = await noShowReport(loc.id, range.from, range.to);
  const when = (d: Date) => DateTime.fromJSDate(d).setZone(tz).toFormat("ccc, LLL d yyyy · h:mm a");

  return csvResponse(
    `no-shows-${range.fromKey}_${range.toKey}.csv`,
    [
      "Booking",
      "Customer",
      "Phone",
      "Email",
      "Tour",
      "Original date & time",
      "Vehicles booked",
      "Vehicles no-show",
      "Checked in too?",
      "Unpaid balance",
      "Latest status",
      "Latest note",
      "Attempts",
    ],
    rows.map((r) => [
      r.displayNumber,
      r.customerName,
      r.phone ?? "",
      r.email ?? "",
      r.itemName,
      when(r.startsAt),
      r.vehicles,
      r.noShowUnits,
      r.disputed ? "YES — check before calling" : "",
      (r.balanceDueCents / 100).toFixed(2),
      r.latestStatus ? followupLabel(r.latestStatus) : "not attempted",
      r.latestNote ?? "",
      r.followUpCount,
    ]),
  );
}
