"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBookingCheckIn, setLineCheckInCounts } from "@/lib/actions/bookings";

type UnitStatus = "not_yet" | "checked_in" | "no_show";
const OPTIONS: { value: UnitStatus; label: string }[] = [
  { value: "not_yet", label: "Not yet" },
  { value: "checked_in", label: "Checked in" },
  { value: "no_show", label: "No-show" },
];

function btnCls(on: boolean, value: UnitStatus, size: "sm" | "md") {
  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";
  if (!on)
    return `rounded-md border border-zinc-300 font-medium text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800 ${pad}`;
  const tone =
    value === "checked_in"
      ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : value === "no_show"
        ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
        : "border-zinc-400 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";
  return `rounded-md border font-medium ${tone} ${pad}`;
}

// Booking-level "set all vehicles" control.
export function CheckInControls({
  slug,
  bookingId,
  current,
  size = "md",
}: {
  slug: string;
  bookingId: string;
  current: string;
  size?: "sm" | "md";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-1">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await setBookingCheckIn(slug, bookingId, o.value);
              if (!r.ok) setError(r.error ?? "Failed");
              else router.refresh();
            });
          }}
          className={`disabled:opacity-50 ${btnCls(current === o.value, o.value, size)}`}
        >
          {o.value === "checked_in" ? "All in" : o.label}
        </button>
      ))}
      {current === "partial" && <span className="ml-1 text-xs italic text-amber-600">partial</span>}
      {error && <span className="ml-1 text-xs text-red-600">{error}</span>}
    </div>
  );
}

// Per-vehicle check-in for one line: a row per vehicle, each its own status.
export function LineCheckIn({
  slug,
  lineId,
  ctName,
  quantity,
  checkedInUnits,
  noShowUnits,
}: {
  slug: string;
  lineId: string;
  ctName: string;
  quantity: number;
  checkedInUnits: number;
  noShowUnits: number;
}) {
  const initial: UnitStatus[] = Array.from({ length: quantity }, (_, i) =>
    i < checkedInUnits ? "checked_in" : i < checkedInUnits + noShowUnits ? "no_show" : "not_yet",
  );
  const [units, setUnits] = useState<UnitStatus[]>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function setUnit(i: number, s: UnitStatus) {
    const next = units.map((u, j) => (j === i ? s : u));
    setUnits(next);
    setError(null);
    const c = next.filter((x) => x === "checked_in").length;
    const n = next.filter((x) => x === "no_show").length;
    startTransition(async () => {
      const r = await setLineCheckInCounts(slug, lineId, c, n);
      if (!r.ok) {
        setError(r.error ?? "Failed");
        setUnits(initial);
      } else router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      {units.map((u, i) => (
        <div key={i} className="flex items-center justify-between gap-2">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">
            {ctName} {quantity > 1 ? `#${i + 1}` : ""}
          </span>
          <div className="flex items-center gap-1">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={pending}
                onClick={() => setUnit(i, o.value)}
                className={`disabled:opacity-50 ${btnCls(u === o.value, o.value, "sm")}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
