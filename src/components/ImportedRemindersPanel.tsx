"use client";

import { useState, useTransition } from "react";
import { BellRing, TriangleAlert } from "lucide-react";
import { armImportedReminders } from "@/lib/actions/importedReminders";

export function ImportedRemindersPanel({
  slug,
  initialPending,
}: {
  slug: string;
  initialPending: number;
}) {
  const [pending, setPending] = useState(initialPending);
  const [armed, setArmed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Two-step because this sends real email to real customers. A single click
  // that reaches hundreds of inboxes is not a button, it's a trap.
  const [confirming, setConfirming] = useState(false);
  const [busy, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      const r = await armImportedReminders(slug);
      if (!r.ok) {
        setError(r.error);
        setConfirming(false);
        return;
      }
      setArmed((a) => a + r.armed);
      setFailed((f) => f + r.failed);
      setPending(r.remaining);
      setConfirming(false);
    });
  }

  if (pending === 0) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          Every imported booking has its reminders
        </p>
        <p className="mt-1 text-sm text-emerald-900/80 dark:text-emerald-100/80">
          {armed > 0
            ? `Armed ${armed} in this session. Nothing left to do.`
            : "Nothing to arm. Bookings taken on our own checkout schedule their own reminders automatically."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm">
        <span className="text-2xl font-bold tabular-nums">{pending}</span>{" "}
        imported booking{pending === 1 ? "" : "s"} with a future tour and{" "}
        <span className="font-semibold">no reminder scheduled</span>.
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Bookings taken on our own checkout arm themselves. These came from a CSV,
        so they never went through that step — without this, these customers are
        simply never reminded.
      </p>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/60 dark:bg-amber-950/40">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <p className="text-xs text-amber-900 dark:text-amber-100">
          <span className="font-semibold">Turn off the old system&rsquo;s reminders first.</span>{" "}
          These bookings still exist in whatever system they were exported from, and
          it will keep sending its own reminders until someone disables them. Arm
          these while those are still on and every one of these customers is
          reminded twice.
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
      {(armed > 0 || failed > 0) && (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          Armed {armed} so far{failed > 0 ? ` · ${failed} failed` : ""}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              onClick={run}
              disabled={busy}
              className="rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {busy ? "Scheduling…" : `Yes — schedule reminders for ${Math.min(pending, 120)}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <BellRing className="h-4 w-4" />
            Arm reminders
          </button>
        )}
        {pending > 120 && !confirming && (
          <span className="text-xs text-zinc-500">
            Runs 120 at a time — press again until it reaches zero.
          </span>
        )}
      </div>
    </div>
  );
}
