"use client";

import { useState, useTransition } from "react";
import { StickyNote } from "lucide-react";
import { setBookingNote } from "@/lib/actions/bookings";

/**
 * The internal note on a booking — written by whoever takes the call, read by
 * whoever runs check-in.
 *
 * Styled as an alert rather than a caption on purpose. A note exists because
 * somebody needs to ACT on it, and the old grey `text-xs` treatment made it
 * read like decoration next to the data it was trying to interrupt.
 *
 * Read-only for anyone without `manage_bookings`, but still VISIBLE to them —
 * check-in staff are exactly the people who need to read it and exactly the
 * people who shouldn't be editing bookings.
 */
export function BookingNote({
  slug,
  bookingId,
  note,
  canEdit,
  onSaved,
}: {
  slug: string;
  bookingId: string;
  note: string | null;
  canEdit: boolean;
  onSaved?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const r = await setBookingNote(slug, bookingId, text);
      if (!r.ok) {
        setError(r.error ?? "Could not save the note.");
        return;
      }
      setEditing(false);
      onSaved?.();
    });
  }

  if (!editing) {
    if (!note) {
      if (!canEdit) return null;
      return (
        <button
          type="button"
          onClick={() => {
            setText("");
            setEditing(true);
          }}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          <StickyNote className="h-3.5 w-3.5" /> Add a note for check-in
        </button>
      );
    }
    return (
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/40">
        <div className="flex items-start gap-2">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
              Note for check-in
            </p>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-amber-900 dark:text-amber-100">
              {note}
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setText(note);
                setEditing(true);
              }}
              className="shrink-0 text-xs font-medium text-amber-800 underline hover:text-amber-950 dark:text-amber-300"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/40">
      <label className="text-xs font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
        Note for check-in
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        autoFocus
        placeholder="Anything the check-in team should know — a late arrival, a birthday, a rider swap."
        className="mt-1.5 w-full rounded-md border border-amber-300 bg-white px-2.5 py-2 text-sm dark:border-amber-800/60 dark:bg-zinc-900"
      />
      <p className="mt-1 text-[11px] text-amber-800/80 dark:text-amber-300/70">
        Staff only — the customer never sees this.
      </p>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save note"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setText(note ?? "");
            setError(null);
          }}
          disabled={pending}
          className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800/60 dark:text-amber-200 dark:hover:bg-amber-950"
        >
          Cancel
        </button>
        {note && (
          <button
            type="button"
            onClick={() => {
              setText("");
              start(async () => {
                const r = await setBookingNote(slug, bookingId, "");
                if (!r.ok) return setError(r.error ?? "Could not remove the note.");
                setEditing(false);
                onSaved?.();
              });
            }}
            disabled={pending}
            className="ml-auto text-xs text-amber-800/70 underline hover:text-amber-950 dark:text-amber-300/70"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
