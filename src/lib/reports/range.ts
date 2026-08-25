import { DateTime } from "luxon";

/**
 * The date range every report runs on, resolved once.
 *
 * Six files hand-rolled this same `?from=&to=` parsing, each with its own copy of the regex and its
 * own idea of whether `to` was inclusive. Getting that wrong loses or double-counts a whole day at
 * the edge of every report, silently — the totals still look like totals.
 *
 * `to` is INCLUSIVE as the user means it and EXCLUSIVE as the query needs it: the returned `to` is
 * the start of the day after `toKey`. That is the existing convention in `reports/page.tsx`; it is
 * written down here so it stops being re-derived.
 */

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type RangePreset = "today" | "week" | "rolling7" | "month" | "last30";

export type ResolvedRange = {
  fromKey: string;
  toKey: string;
  /** UTC instant at the start of `fromKey`, in the location's zone. */
  from: Date;
  /** UTC instant at the start of the day AFTER `toKey` — half-open, so use `< to`. */
  to: Date;
  label: string;
};

function day(key: string, tz: string): DateTime {
  return DateTime.fromISO(key, { zone: tz }).startOf("day");
}

export function resolveRange(
  sp: { from?: string; to?: string; preset?: string },
  tz: string,
  fallback: RangePreset = "last30",
): ResolvedRange {
  const now = DateTime.now().setZone(tz);

  // An explicit from/to always wins over a preset — the user typed it.
  let fromKey: string;
  let toKey: string;
  if (sp.from && DAY_RE.test(sp.from) && sp.to && DAY_RE.test(sp.to)) {
    fromKey = sp.from;
    toKey = sp.to;
  } else {
    const preset = (isPreset(sp.preset) ? sp.preset : fallback) as RangePreset;
    [fromKey, toKey] = presetKeys(preset, now);
  }

  // A backwards range returns nothing and looks like "no data" rather than a mistake. Swap it.
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];

  const fromDt = day(fromKey, tz);
  const toDt = day(toKey, tz);
  return {
    fromKey,
    toKey,
    from: fromDt.toUTC().toJSDate(),
    to: toDt.plus({ days: 1 }).toUTC().toJSDate(),
    label:
      fromKey === toKey
        ? fromDt.toFormat("cccc, LLL d")
        : `${fromDt.toFormat("LLL d")} – ${toDt.toFormat("LLL d, yyyy")}`,
  };
}

function isPreset(v: string | undefined): v is RangePreset {
  return v === "today" || v === "week" || v === "rolling7" || v === "month" || v === "last30";
}

function presetKeys(preset: RangePreset, now: DateTime): [string, string] {
  const k = (d: DateTime) => d.toFormat("yyyy-LL-dd");
  switch (preset) {
    case "today":
      return [k(now), k(now)];
    // Luxon's week starts on Monday, which is the convention the venue uses and what the bookings
    // grid already does. Keep the two in step.
    case "week":
      return [k(now.startOf("week")), k(now.endOf("week"))];
    case "rolling7":
      return [k(now.minus({ days: 6 })), k(now)];
    case "month":
      return [k(now.startOf("month")), k(now)];
    case "last30":
      return [k(now.minus({ days: 29 })), k(now)];
  }
}

export const PRESETS: { key: RangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "rolling7", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
];
