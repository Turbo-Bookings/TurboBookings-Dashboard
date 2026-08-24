"use client";

import { DateTime } from "luxon";

/**
 * When a booking was made, and when it was cancelled.
 *
 * Staff judging a refund need the booking's CREATED time — `getCancellationRefund` keys its
 * grace-period branch off `bookings.created_at` — but the UI only ever showed the tour time, so the
 * verdict ("No refund — outside the cancellation window") appeared without the input that produced
 * it. `cancelled_at` had zero references in any component at all.
 *
 * Rendered in the LOCATION's timezone, not the viewer's: a rep in Egypt judging a Dallas booking
 * needs Dallas time. Format matches RecentBookings so "booked" and "tour" times read alike.
 */
export function BookingStamps({
  createdAt,
  cancelledAt,
  tz,
}: {
  createdAt: Date | string | null;
  cancelledAt: Date | string | null;
  tz: string;
}) {
  const fmt = (v: Date | string) =>
    DateTime.fromJSDate(new Date(v)).setZone(tz).toFormat("LLL d, yyyy · h:mm a");

  // Relative age is the part staff actually reason with — "3 days ago" answers the refund question
  // faster than a date does.
  const ago = (v: Date | string) => {
    const rel = DateTime.fromJSDate(new Date(v)).setZone(tz).toRelative();
    return rel ?? null;
  };

  if (!createdAt && !cancelledAt) return null;

  return (
    <dl className="mt-3 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
      {createdAt && (
        <div className="flex gap-2">
          <dt className="w-16 shrink-0">Booked</dt>
          <dd className="tabular-nums">
            {fmt(createdAt)}
            {ago(createdAt) ? <span className="text-zinc-400"> · {ago(createdAt)}</span> : null}
          </dd>
        </div>
      )}
      {cancelledAt && (
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-red-600 dark:text-red-400">Cancelled</dt>
          <dd className="tabular-nums text-red-600 dark:text-red-400">
            {fmt(cancelledAt)}
            {ago(cancelledAt) ? <span className="opacity-70"> · {ago(cancelledAt)}</span> : null}
          </dd>
        </div>
      )}
    </dl>
  );
}
