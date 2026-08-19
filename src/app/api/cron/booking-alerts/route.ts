import { and, eq, isNull, sql } from "drizzle-orm";

import {
  availabilities,
  bookings,
  customers,
  getDb,
  items,
  locations,
} from "@/lib/db";
import { sendToLocation, pushConfigured } from "@/lib/push/send";

// Cron-driven new-booking push alerts. Scheduled every minute via vercel.json.
//
// Two guards keep this from ever spamming an operator:
//   1. bookings.alerted_at — stamped after each attempt, so a retry or two
//      overlapping ticks can't notify twice for the same booking.
//   2. A short creation window — this is what stopped the very first run from
//      firing an alert for all 198 bookings that already existed. It also means
//      an outage that lasts longer than the window drops the alerts rather than
//      delivering a burst of stale ones hours later, which is the behaviour we
//      want: by then the booking is visible in the dashboard anyway.
const WINDOW_MINUTES = 20;
const BATCH_SIZE = 25;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!pushConfigured()) {
    return Response.json({ ok: true, skipped: true, reason: "VAPID not configured" });
  }

  const db = getDb();
  const due = await db
    .select({
      id: bookings.id,
      locationId: bookings.locationId,
      displayNumber: bookings.displayNumber,
      totalCents: bookings.totalCents,
      depositPaidCents: bookings.depositPaidCents,
      source: bookings.source,
      slug: locations.slug,
      locationName: locations.brandDisplayName,
      timezone: locations.timezone,
      itemName: items.name,
      startsAt: availabilities.startsAt,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(bookings)
    .innerJoin(locations, eq(bookings.locationId, locations.id))
    .innerJoin(items, eq(bookings.itemId, items.id))
    .innerJoin(availabilities, eq(bookings.availabilityId, availabilities.id))
    .innerJoin(customers, eq(bookings.customerId, customers.id))
    .where(
      and(
        isNull(bookings.alertedAt),
        eq(bookings.status, "active"),
        // created_at is a naive timestamp storing UTC wall-clock, so it must be
        // compared against UTC-now rather than the session zone.
        sql`${bookings.createdAt} > (now() at time zone 'utc') - interval '${sql.raw(
          String(WINDOW_MINUTES),
        )} minutes'`,
      ),
    )
    .limit(BATCH_SIZE);

  let notified = 0;
  let devices = 0;
  let pruned = 0;

  for (const b of due) {
    const name = [b.firstName, b.lastName].filter(Boolean).join(" ") || "Guest";
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: b.timezone ?? "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(b.startsAt);

    const label = b.locationName ?? b.slug;
    // Deposit is what actually landed in the account; total is what the booking
    // is worth. Operators asked to see both — "collected / value" answers the
    // two questions they have on seeing an alert.
    const amounts =
      b.depositPaidCents > 0 && b.depositPaidCents < b.totalCents
        ? `${money(b.depositPaidCents)} paid of ${money(b.totalCents)}`
        : money(b.totalCents);

    const result = await sendToLocation(b.locationId, {
      title: `New booking · ${label}`,
      body: `${name} · ${b.itemName}\n${when} · ${amounts}`,
      url: `/locations/${b.slug}/bookings/${b.id}`,
      tag: `booking-${b.id}`,
    });

    // Stamped whether or not anyone was subscribed: the booking has had its
    // one chance at an alert, and leaving it unstamped would make it re-appear
    // on every tick until it aged out of the window.
    await db
      .update(bookings)
      .set({ alertedAt: new Date() })
      .where(eq(bookings.id, b.id));

    notified += 1;
    devices += result.sent;
    pruned += result.pruned;
  }

  return Response.json({ ok: true, bookings: notified, devices, pruned });
}
