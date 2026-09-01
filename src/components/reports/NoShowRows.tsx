"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { DateTime } from "luxon";
import { TrendingUp, TriangleAlert } from "lucide-react";
import { FollowUpLog } from "@/components/FollowUpLog";
import {
  BUCKET_LABEL,
  MAX_ATTEMPTS,
  NO_SHOW_CLOSE_REASONS,
  OUTCOME_LABEL,
  type CaseOutcome,
  type QueueBucket,
} from "@/lib/booking/noShowCase";
import { closeNoShowCase, reopenNoShowCase } from "@/lib/actions/followups";
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
  /**
   * Whether this occurrence was won back. Keyed on (booking, missed tour), so a booking that missed,
   * came back, and missed again appears twice — once won, once still to chase.
   */
  outcome: "open" | "won_back";
  wonBackToIso: string | null;
  wonBackToItemName: string | null;
  /** Full workflow state — see lib/booking/noShowCase.ts. */
  caseOutcome: CaseOutcome;
  bucket: QueueBucket;
  attempts: number;
  nextFollowUpAtIso: string | null;
  /** Closed by any route — won back, refused, 3 attempts, or by hand. */
  caseState_isClosed: boolean;
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
  const [busy, setBusy] = useState<string | null>(null);

  async function run(k: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(k);
    const r = await fn();
    setBusy(null);
    if (r.ok) router.refresh();
  }

  const when = (iso: string) =>
    DateTime.fromISO(iso).setZone(tz).toFormat("ccc, LLL d · h:mm a");

  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {rows.map((r) => (
        <li
          key={`${r.bookingId}:${r.startsAtIso}`}
          className={r.outcome === "won_back" ? "bg-emerald-50/40 p-3 dark:bg-emerald-950/20" : "p-3"}
        >
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
            {r.outcome === "won_back" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                <TrendingUp className="h-3 w-3" /> Won back
                {r.wonBackToIso ? ` → ${when(r.wonBackToIso)}` : ""}
                {r.wonBackToItemName ? ` · ${r.wonBackToItemName}` : ""}
              </span>
            )}
            {r.caseOutcome !== "open" && r.caseOutcome !== "won_back" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {OUTCOME_LABEL[r.caseOutcome]}
              </span>
            )}
            {r.caseOutcome === "open" && (r.bucket === "overdue" || r.bucket === "due_today") && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  r.bucket === "overdue"
                    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200"
                }`}
              >
                {BUCKET_LABEL[r.bucket]}
                {r.nextFollowUpAtIso ? ` · ${when(r.nextFollowUpAtIso)}` : ""}
              </span>
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

          {/*
            The workflow controls. A rep needs three things a call list has never had: a way to say
            "try again on Tuesday", a way to give up, and a way to undo giving up. Everything else
            about the case state — attempts, refusals, win-backs — is derived and needs no control.
          */}
          {canLog && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {!r.caseState_isClosed ? (
                <>
                  <span className="text-zinc-400">
                    {r.attempts}/{MAX_ATTEMPTS} attempts
                  </span>
                  {/*
                    No date picker. The cadence is automatic — due on the no-show mark, then 24h
                    after each logged attempt — so there is nothing for a rep to decide, only
                    something to tell them.
                  */}
                  <span className="text-zinc-500">
                    {r.nextFollowUpAtIso
                      ? r.bucket === "overdue"
                        ? `Due since ${when(r.nextFollowUpAtIso)}`
                        : r.attempts === 0
                          ? "Call now"
                          : `Next attempt ${when(r.nextFollowUpAtIso)}`
                      : ""}
                  </span>
                  <select
                    defaultValue=""
                    disabled={busy === `close-${r.bookingId}`}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      run(`close-${r.bookingId}`, () =>
                        closeNoShowCase(slug, r.bookingId, r.startsAtIso, e.target.value),
                      );
                    }}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                  >
                    <option value="">Close case…</option>
                    {NO_SHOW_CLOSE_REASONS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                r.caseOutcome !== "won_back" && (
                  <button
                    type="button"
                    disabled={busy === `reopen-${r.bookingId}`}
                    onClick={() =>
                      run(`reopen-${r.bookingId}`, () =>
                        reopenNoShowCase(slug, r.bookingId, r.startsAtIso),
                      )
                    }
                    className="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    Reopen
                  </button>
                )
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
