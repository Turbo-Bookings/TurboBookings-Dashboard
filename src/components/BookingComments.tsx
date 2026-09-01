"use client";

import { useState, useTransition } from "react";
import { DateTime } from "luxon";
import { MessageSquare } from "lucide-react";
import { addBookingComment, type BookingCommentEntry } from "@/lib/actions/comments";

/**
 * The comment thread on one booking, and the box to add to it.
 *
 * Separate from `FollowUpLog`, which records a call attempt with an OUTCOME that reports count.
 * This is plain prose — "customer says they were here", "gave them a voucher", "second party turned
 * up late" — and it is available on every booking regardless of date or status, which is the point:
 * the reported problem was that a tour which had already run could not be annotated.
 *
 * Entries are never edited. Correcting something means writing what actually happened, which is also
 * the record of who was working.
 */
export function BookingComments({
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
  entries: BookingCommentEntry[];
  tz: string;
  /** The `comment` capability — basic_user and up. */
  canAdd: boolean;
  onAdded?: () => void;
  /** Tighter layout for use inside a report row. */
  compact?: boolean;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const text = body.trim();
    if (!text) {
      setError("Write something first.");
      return;
    }
    setError(null);
    start(async () => {
      const r = await addBookingComment(slug, bookingId, text);
      if (!r.ok) {
        setError(r.error ?? "Could not save that.");
        return;
      }
      setBody("");
      onAdded?.();
    });
  }

  const fmt = (d: Date) =>
    DateTime.fromJSDate(d).setZone(tz).toFormat("d LLL, h:mm a");

  return (
    <div className={compact ? "" : "mt-5 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"}>
      {!compact && (
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <MessageSquare className="h-3.5 w-3.5" />
          Comments
        </h2>
      )}

      {entries.length === 0 ? (
        <p className={`${compact ? "" : "mt-2"} text-xs text-zinc-400`}>
          No comments yet.
        </p>
      ) : (
        <ul className={`${compact ? "" : "mt-3"} space-y-2`}>
          {entries.map((e) => (
            <li key={e.id} className="text-sm">
              <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
                {e.body}
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                {e.byName ? `${e.byName} · ` : ""}
                {fmt(e.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {canAdd && (
        <div className="mt-3">
          <textarea
            value={body}
            onChange={(ev) => setBody(ev.target.value)}
            rows={compact ? 2 : 3}
            maxLength={2000}
            placeholder="Add a comment…"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Comment"}
            </button>
            {error && (
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                {error}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
