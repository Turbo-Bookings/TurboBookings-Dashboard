"use client";

import { useState, useTransition } from "react";
import { DateTime } from "luxon";
import { Phone } from "lucide-react";
import { addFollowUp, type FollowupEntry } from "@/lib/actions/followups";
import {
  FOLLOWUP_STATUSES,
  followupLabel,
  followupToneClass,
} from "@/lib/booking/followupStatus";

/**
 * The outreach trail on one booking, and the control to add to it.
 *
 * Used in two places — inside a no-show report row, and on the booking page — so an attempt logged
 * from either is the same record. A rep working the call list and a manager opening the booking are
 * looking at one history, not two.
 *
 * Entries are never edited. The form clears and the new attempt joins the list; correcting something
 * means logging what actually happened, which is also the record of who was working.
 */
export function FollowUpLog({
  slug,
  bookingId,
  entries,
  tz,
  canAdd,
  onAdded,
  compact,
}: {
  slug: string;
  bookingId: string;
  entries: FollowupEntry[];
  tz: string;
  canAdd: boolean;
  onAdded?: () => void;
  /** Tighter layout for use inside a report row. */
  compact?: boolean;
}) {
  const [status, setStatus] = useState<string>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!status) {
      setError("Pick an outcome.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await addFollowUp(slug, bookingId, status, note);
      if (!r.ok) {
        setError(r.error ?? "Could not save.");
        return;
      }
      setStatus("");
      setNote("");
      onAdded?.();
    });
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {entries.length > 0 && (
        <ol className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
              <span className="tabular-nums text-zinc-400">
                {DateTime.fromJSDate(new Date(e.createdAt)).setZone(tz).toFormat("LLL d, h:mm a")}
              </span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${followupToneClass(e.status)}`}>
                {followupLabel(e.status)}
              </span>
              <span className="font-medium text-zinc-600 dark:text-zinc-300">{e.byName}</span>
              {e.note && <span className="text-zinc-500">— {e.note}</span>}
            </li>
          ))}
        </ol>
      )}

      {canAdd ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Outcome…</option>
            {FOLLOWUP_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened?"
            maxLength={2000}
            className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Phone className="h-3 w-3" /> {pending ? "Saving…" : "Log"}
          </button>
        </div>
      ) : (
        entries.length === 0 && <p className="text-xs text-zinc-400">No follow-ups logged.</p>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
