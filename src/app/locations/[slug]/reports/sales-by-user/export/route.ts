import { DateTime } from "luxon";
import { csvResponse, dayParam, guardExport } from "@/lib/csv";
import { salesByUser } from "@/lib/data/reports";
import { resolveRange } from "@/lib/reports/range";
import { labelFor, resolveUserLabels } from "@/lib/users";

/** Who took which bookings, on the date they were made. */
export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await guardExport(slug, "view_revenue");
  if (!guard.ok) return guard.response;
  const loc = guard.location;
  const tz = loc.timezone ?? "America/Chicago";

  const url = new URL(request.url);
  const now = DateTime.now().setZone(tz);
  const range = resolveRange(
    {
      from: dayParam(url, "from", now.minus({ days: 29 }).toFormat("yyyy-LL-dd")),
      to: dayParam(url, "to", now.toFormat("yyyy-LL-dd")),
    },
    tz,
    "last30",
  );

  const rows = await salesByUser(loc.id, range.from, range.to);
  const actors = await resolveUserLabels(rows.map((r) => r.userId));

  return csvResponse(
    `sales-by-user-${range.fromKey}_${range.toKey}.csv`,
    ["Person", "Email", "Bookings", "Vehicles", "Value"],
    rows.map((r) => [
      // Self-serve is a row in the sheet too, for the same reason it is one on the page: without it
      // every percentage is over an unstated subset.
      r.userId ? labelFor(actors, r.userId).name : "Online (self-serve)",
      r.userId ? (labelFor(actors, r.userId).email ?? "") : "",
      r.bookings,
      r.vehicles,
      (r.salesCents / 100).toFixed(2),
    ]),
  );
}
