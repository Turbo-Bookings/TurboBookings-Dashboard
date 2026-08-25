import { DateTime } from "luxon";
import { listBookingsForCsv } from "@/lib/data/bookings";
import { cell, DAY_RE, guardExport } from "@/lib/csv";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  // The manifest export is the day's run sheet — same audience as the manifest itself.
  //
  // Route handlers do NOT run the subtree layout, so the gate one directory up never applied here —
  // any signed-in user with any role at this location could fetch this by typing the URL.
  const guard = await guardExport(slug, "checkin");
  if (!guard.ok) return guard.response;
  const loc = guard.location;
  const tz = loc.timezone ?? "America/Chicago";

  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const dateKey =
    dateParam && DAY_RE.test(dateParam) ? dateParam : DateTime.now().setZone(tz).toFormat("yyyy-LL-dd");
  const day = DateTime.fromISO(dateKey, { zone: tz }).startOf("day");
  const from = day.toUTC().toJSDate();
  const to = day.plus({ days: 1 }).toUTC().toJSDate();

  const rows = await listBookingsForCsv(loc.id, from, to);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });

  const header = ["Time", "Tour", "Booking", "Customer", "Vehicles", "Status", "Due"];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        fmt.format(r.startsAt),
        r.itemName,
        r.displayNumber,
        r.customerName,
        r.pax,
        r.status,
        (r.balanceCents / 100).toFixed(2),
      ]
        .map(cell)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="manifest-${dateKey}.csv"`,
    },
  });
}
