"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { DateTime } from "luxon";
import { TriangleAlert } from "lucide-react";
import { FollowUpLog } from "@/components/FollowUpLog";
import { followupLabel, followupToneClass } from "@/lib/booking/followupStatus";
import { usd } from "@/lib/ui/money";
import type { FollowupEntry } from "@/lib/actions/followups";

export type NoShowView = {
  bookingId: string;
  displayNumber: string;
  customerName: string;
  phone: string | null;
  itemName: string;
  startsAtIso: string;
  vehicles: number;
  noShowUnits: number;
  disputed: boolean;
  balanceDueCents: number;
  latest: FollowupEntry | null;
  followUpCount: number;
};

/**
 * The call list.
 *
 * Laid out for someone working the phone top to bottom: the tour time they missed is stated in full
 * because a rep has to say it out loud, and the phone number is a `tel:` link so a click dials on a
 * phone or a softphone rather than being copied by hand.
 *
 * Logging an outcome happens in the row. Sending someone to the booking page to record a call and
 * then back to find their place is how a list stops getting worked.
 */
export function NoShowRows({
  slug,
  rows,
  tz,
  canLog,
}: {
  slug: string;
  rows: NoShowView[];
  tz: string;
  canLog: boolean;
}) {
  const router = useRouter();
  const when = (iso: string) =>
    DateTime.fromISO(iso).setZone(tz).toFormat("ccc, LLL d · h:mm a");

  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map((r) => (
        <li key={r.bookingId} className="p-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link
              href={`/locations/${slug}/bookings/${r.bookingId}`}
              className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              #{r.displayNumber}
            </Link>
            <span className="text-sm font-medium">{r.customerName}</span>
            {r.phone ? (
              <a
                href={`tel:${r.phone}`}
                className="text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                {r.phone}
              </a>
            ) : (
              <span className="text-sm text-zinc-400">no phone on file</span>
            )}
            {r.disputed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-200">
                <TriangleAlert className="h-3 w-3" /> Some vehicles checked in
              </span>
            )}
            <span className="ml-auto text-xs text-zinc-400">
              {r.noShowUnits} of {r.vehicles} vehicle{r.vehicles === 1 ? "" : "s"}
              {r.balanceDueCents > 0 ? ` · ${usd(r.balanceDueCents)} unpaid` : ""}
            </span>
          </div>

          <p className="mt-0.5 text-xs text-zinc-500">
            {r.itemName} · <span className="tabular-nums">{when(r.startsAtIso)}</span>
          </p>

          {r.latest && (
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-medium ${followupToneClass(r.latest.status)}`}>
                {followupLabel(r.latest.status)}
              </span>
              <span className="text-zinc-500">
                {r.latest.byName}
                {r.latest.note ? ` — ${r.latest.note}` : ""}
              </span>
              {r.followUpCount > 1 && (
                <span className="text-zinc-400">
                  ({r.followUpCount} attempts — full trail on the booking)
                </span>
              )}
            </p>
          )}

          <div className="mt-2">
            <FollowUpLog
              slug={slug}
              bookingId={r.bookingId}
              entries={[]}
              tz={tz}
              canAdd={canLog}
              compact
              // Re-render the server component so the latest status and the counts update in place.
              onAdded={() => router.refresh()}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
