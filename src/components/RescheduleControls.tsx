"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rescheduleBooking } from "@/lib/actions/bookings";

type Slot = { id: string; startsAt: string; remaining: number };

export function RescheduleControls({
  slug,
  bookingId,
  currentId,
  slots,
  tz,
}: {
  slug: string;
  bookingId: string;
  currentId: string;
  slots: Slot[];
  tz: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [feeDollars, setFeeDollars] = useState("0");
  const [reason, setReason] = useState("");

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [tz],
  );

  const options = slots.filter((s) => s.id !== currentId && s.remaining > 0);

  function go() {
    if (!to) return;
    setError(null);
    startTransition(async () => {
      const r = await rescheduleBooking(
        slug,
        bookingId,
        to,
        Math.round(Number(feeDollars) * 100),
        reason,
      );
      if (!r.ok) setError(r.error ?? "Failed");
      else {
        setTo("");
        router.refresh();
      }
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Reschedule
      </h3>
      {options.length === 0 ? (
        <p className="mt-1 text-xs text-zinc-400">No other times available for this tour.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">Move to…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {fmt.format(new Date(s.startsAt))} ({s.remaining} left)
              </option>
            ))}
          </select>
          <span className="text-sm text-zinc-500">fee $</span>
          <input
            type="number"
            min={0}
            value={feeDollars}
            onChange={(e) => setFeeDollars(e.target.value)}
            className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            className="w-40 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            disabled={pending || !to}
            onClick={go}
            className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Move
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
