import { DateTime } from "luxon";
import { csvResponse, dayParam, guardExport } from "@/lib/csv";
import { salesByUser, upsellsByUser } from "@/lib/data/reports";
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

  const [rows, upsells] = await Promise.all([
    salesByUser(loc.id, range.from, range.to),
    upsellsByUser(loc.id, range.from, range.to),
  ]);
  const actors = await resolveUserLabels([
    ...rows.map((r) => r.userId),
    ...upsells.map((u) => u.userId),
  ]);
  // Additions keyed by person, so each row carries both halves of what they sold.
  const upsellBy = new Map(upsells.map((u) => [u.userId ?? "__unattributed__", u]));

  return csvResponse(
    `sales-by-user-${range.fromKey}_${range.toKey}.csv`,
    [
      "Person",
      "Email",
      "Bookings taken",
      "Vehicles booked",
      "Value booked",
      "Additions at the desk",
      "Vehicles added",
      "Value added",
    ],
    // Every person who did EITHER — someone who only worked check-in sold real vehicles and would
    // otherwise be missing from their own sales sheet.
    [...new Set([...rows.map((r) => r.userId ?? "__unattributed__"), ...upsellBy.keys()])].map(
      (key) => {
        const r = rows.find((x) => (x.userId ?? "__unattributed__") === key);
        const u = upsellBy.get(key);
        const userId = r?.userId ?? u?.userId ?? null;
        return [
          // Self-serve is a row in the sheet too, for the same reason it is one on the page: without
          // it every percentage is over an unstated subset.
          userId ? labelFor(actors, userId).name : "Online (self-serve)",
          userId ? (labelFor(actors, userId).email ?? "") : "",
          r?.bookings ?? 0,
          r?.vehicles ?? 0,
          ((r?.salesCents ?? 0) / 100).toFixed(2),
          u?.additions ?? 0,
          u?.vehicles ?? 0,
          ((u?.addedCents ?? 0) / 100).toFixed(2),
        ];
      },
    ),
  );
}
