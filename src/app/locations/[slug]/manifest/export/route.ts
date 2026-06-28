import { DateTime } from "luxon";
import { listBookingsForCsv } from "@/lib/data/bookings";
import { getLocationBySlug } from "@/lib/data/locations";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function cell(s: string | number): string {
  return `"${String(s).replace(/"/g, '""')}"`;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const loc = await getLocationBySlug(slug);
  if (!loc) return new Response("Not found", { status: 404 });
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

  const header = ["Time", "Tour", "Booking", "Customer", "Pax", "Status", "Due"];
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
