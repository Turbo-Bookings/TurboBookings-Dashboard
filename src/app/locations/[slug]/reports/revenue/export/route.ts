import { DateTime } from "luxon";
import { listBookingsForCsv } from "@/lib/data/bookings";
import { cell, DAY_RE, guardExport } from "@/lib/csv";
import { can } from "@/lib/auth/roles";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  // A full revenue export. Same bar as the reports section it is downloaded from.
  //
  // Route handlers do NOT run the subtree layout, so the gate one directory up never applied here —
  // any signed-in user with any role at this location could fetch this by typing the URL.
  const guard = await guardExport(slug, "view_revenue");
  if (!guard.ok) return guard.response;
  const loc = guard.location;
  const tz = loc.timezone ?? "America/Chicago";

  const url = new URL(request.url);
  const today = DateTime.now().setZone(tz);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const fromKey = fromParam && DAY_RE.test(fromParam) ? fromParam : today.minus({ days: 30 }).toFormat("yyyy-LL-dd");
  const toKey = toParam && DAY_RE.test(toParam) ? toParam : today.toFormat("yyyy-LL-dd");
  const from = DateTime.fromISO(fromKey, { zone: tz }).startOf("day").toUTC().toJSDate();
  const to = DateTime.fromISO(toKey, { zone: tz }).plus({ days: 1 }).startOf("day").toUTC().toJSDate();

  // Platform processing fee is Turbo-internal — only admins get the Fee column.
  const showFees = await can("manage_platform", slug);
  const rows = await listBookingsForCsv(loc.id, from, to);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const header = [
    "Booking", "Status", "Source", "When", "Tour", "Customer", "Email", "Vehicles",
    "Sales", "Discount",
    ...(showFees ? ["Fee"] : []),
    "Tax (online)", "Total", "Paid (online)", "Balance (venue)", "Refunded",
  ];
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
        (r.salesCents / 100).toFixed(2),
        (r.discountCents / 100).toFixed(2),
        ...(showFees ? [(r.feeCents / 100).toFixed(2)] : []),
        (r.taxCents / 100).toFixed(2),
        (r.totalCents / 100).toFixed(2),
        (r.paidCents / 100).toFixed(2),
        (r.balanceCents / 100).toFixed(2),
        (r.refundedCents / 100).toFixed(2),
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
