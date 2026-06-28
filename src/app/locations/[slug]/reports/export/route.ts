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
  const today = DateTime.now().setZone(tz);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const fromKey = fromParam && DAY_RE.test(fromParam) ? fromParam : today.minus({ days: 30 }).toFormat("yyyy-LL-dd");
  const toKey = toParam && DAY_RE.test(toParam) ? toParam : today.toFormat("yyyy-LL-dd");
  const from = DateTime.fromISO(fromKey, { zone: tz }).startOf("day").toUTC().toJSDate();
  const to = DateTime.fromISO(toKey, { zone: tz }).plus({ days: 1 }).startOf("day").toUTC().toJSDate();

  const rows = await listBookingsForCsv(loc.id, from, to);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const header = ["Booking", "Status", "Source", "When", "Tour", "Customer", "Email", "Pax", "Total", "Paid", "Balance"];
  const lines = [header.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.displayNumber,
        r.status,
        r.source,
        fmt.format(r.startsAt),
        r.itemName,
        r.customerName,
        r.email,
        r.pax,
        (r.totalCents / 100).toFixed(2),
        (r.paidCents / 100).toFixed(2),
        (r.balanceCents / 100).toFixed(2),
      ]
        .map(cell)
        .join(","),
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="bookings-${fromKey}_${toKey}.csv"`,
    },
  });
}
