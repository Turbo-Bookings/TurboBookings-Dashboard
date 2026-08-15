"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Month-grid date picker for the operator new-booking flow. Only days present in
// `availableDays` (location-tz "YYYY-MM-DD" keys) are selectable; prev/next are
// bounded to the months that actually contain availability. Pure calendar
// rendering (UTC math on the date numbers); the keys were computed in the
// location tz upstream. Ported from the customer booking app's Calendar, with
// zinc/blue dashboard tokens.

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function BookingCalendar({
  availableDays,
  selected,
  onSelect,
}: {
  availableDays: string[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const avail = useMemo(() => new Set(availableDays), [availableDays]);
  const sorted = useMemo(() => [...availableDays].sort(), [availableDays]);
  const firstMonth = sorted[0]?.slice(0, 7) ?? null;
  const lastMonth = sorted[sorted.length - 1]?.slice(0, 7) ?? null;
  const [viewMonth, setViewMonth] = useState<string>(
    selected?.slice(0, 7) ?? firstMonth ?? "",
  );

  if (!viewMonth) return null;
  const [y, m] = viewMonth.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(d);

  const canPrev = firstMonth != null && viewMonth > firstMonth;
  const canNext = lastMonth != null && viewMonth < lastMonth;
  function shift(delta: number) {
    const nm = new Date(Date.UTC(y, m - 1 + delta, 1));
    setViewMonth(`${nm.getUTCFullYear()}-${pad(nm.getUTCMonth() + 1)}`);
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => shift(-1)}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">
          {MONTHS[m - 1]} {y}
        </span>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => shift(1)}
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-xs text-zinc-400">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const key = `${y}-${pad(m)}-${pad(d)}`;
          const isAvail = avail.has(key);
          const on = key === selected;
          return (
            <button
              key={key}
              type="button"
              disabled={!isAvail}
              onClick={() => onSelect(key)}
              className={`aspect-square rounded-md text-sm ${
                on
                  ? "bg-blue-600 font-semibold text-white"
                  : isAvail
                    ? "font-medium text-zinc-800 hover:bg-blue-50 dark:text-zinc-100 dark:hover:bg-blue-950/40"
                    : "cursor-default text-zinc-300 dark:text-zinc-700"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
