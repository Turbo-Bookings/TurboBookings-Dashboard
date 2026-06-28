"use client";

import { useState, useTransition } from "react";
import { setBookingCheckIn, setLineCheckIn } from "@/lib/actions/bookings";

type Status = "not_yet" | "checked_in" | "no_show";

const OPTIONS: { value: Status; label: string }[] = [
  { value: "not_yet", label: "Not yet" },
  { value: "checked_in", label: "Checked in" },
  { value: "no_show", label: "No-show" },
];

type Props = {
  slug: string;
  bookingId?: string; // set all lines on the booking
  lineId?: string; // a single rider line
  current: Status | "mixed";
  size?: "sm" | "md";
};

export function CheckInControls({ slug, bookingId, lineId, current, size = "md" }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(status: Status) {
    setError(null);
    startTransition(async () => {
      const r = lineId
        ? await setLineCheckIn(slug, lineId, status)
        : bookingId
          ? await setBookingCheckIn(slug, bookingId, status)
          : { ok: false, error: "missing target" };
      if (!r.ok) setError(r.error ?? "Failed");
    });
  }

  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";
  return (
    <div className="flex items-center gap-1">
      {OPTIONS.map((o) => {
        const on = current === o.value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={pending}
            onClick={() => set(o.value)}
            className={`rounded-md border font-medium disabled:opacity-50 ${pad} ${
              on
                ? o.value === "checked_in"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  : o.value === "no_show"
                    ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                    : "border-zinc-400 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {o.label}
          </button>
        );
      })}
      {current === "mixed" && (
        <span className="ml-1 text-xs italic text-amber-600">mixed</span>
      )}
      {error && <span className="ml-1 text-xs text-red-600">{error}</span>}
    </div>
  );
}
