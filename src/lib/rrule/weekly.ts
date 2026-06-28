// Weekly-recurrence helpers wrapping the `rrule` library. Isomorphic — used
// server-side (actions compile/validate) and client-side (live form preview).
//
// Design (see BOOKING_SYSTEM_SPRINTS.md): the RRULE encodes ONLY the recurrence
// — which weekdays, and the season window (DTSTART…UNTIL) — in naive/floating
// terms. Time-of-day is stored separately on the schedule (startsAtTimeLocal),
// and Sprint D combines recurrence-date + local-time + locations.timezone to
// produce concrete UTC availability slots. Keeping time out of the RRULE avoids
// DST-in-recurrence bugs.

import { RRule, rrulestr, type Weekday } from "rrule";

export type WeekdayCode = "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";

// Display order (calendars start on Sunday), with the rrule constant + label.
export const WEEKDAYS: ReadonlyArray<{
  code: WeekdayCode;
  label: string;
  short: string;
}> = [
  { code: "SU", label: "Sunday", short: "Sun" },
  { code: "MO", label: "Monday", short: "Mon" },
  { code: "TU", label: "Tuesday", short: "Tue" },
  { code: "WE", label: "Wednesday", short: "Wed" },
  { code: "TH", label: "Thursday", short: "Thu" },
  { code: "FR", label: "Friday", short: "Fri" },
  { code: "SA", label: "Saturday", short: "Sat" },
];

const CODE_TO_RRULE: Record<WeekdayCode, Weekday> = {
  SU: RRule.SU,
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
};

// rrule weekday numbering is ISO-ish: MO=0, TU=1, … SU=6.
const RRULE_NUM_TO_CODE: WeekdayCode[] = [
  "MO",
  "TU",
  "WE",
  "TH",
  "FR",
  "SA",
  "SU",
];

// rrule normalizes options.byweekday to numbers, but origOptions can carry
// Weekday objects. Extract a numeric weekday from either shape.
function weekdayToNum(n: unknown): number | null {
  if (typeof n === "number") return n;
  if (n && typeof n === "object" && "weekday" in n) {
    const w = (n as { weekday: unknown }).weekday;
    return typeof w === "number" ? w : null;
  }
  return null;
}

export type WeeklyParts = {
  weekdays: WeekdayCode[];
  /** Season start, "YYYY-MM-DD". Anchors the recurrence (DTSTART). */
  seasonStart: string;
  /** Optional season end, "YYYY-MM-DD" (UNTIL). Omit for open-ended. */
  seasonEnd?: string;
};

// "YYYY-MM-DD" → a UTC-midnight Date used as a naive/floating anchor.
function ymdToUtcDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcDateToYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Compile structured weekly parts → a canonical RRULE string (DTSTART + RRULE
// lines). Returns "" when no weekdays are selected (callers validate before
// persisting).
export function compileWeekly(parts: WeeklyParts): string {
  if (parts.weekdays.length === 0) return "";
  const byweekday = parts.weekdays.map((c) => CODE_TO_RRULE[c]);
  const dtstart = ymdToUtcDate(parts.seasonStart);
  const until = parts.seasonEnd ? ymdToUtcDate(parts.seasonEnd) : undefined;
  const rule = new RRule({
    freq: RRule.WEEKLY,
    byweekday,
    dtstart,
    ...(until ? { until } : {}),
  });
  return rule.toString();
}

// Parse a stored RRULE string back into structured parts for editing. Returns
// null if the text can't be parsed.
export function parseWeekly(rruleText: string): WeeklyParts | null {
  let rule;
  try {
    rule = rrulestr(rruleText);
  } catch {
    return null;
  }
  const opts = "options" in rule ? rule.options : null;
  if (!opts) return null;

  const bw = (opts.byweekday ?? []) as unknown[];
  const weekdays = bw
    .map(weekdayToNum)
    .filter((n): n is number => n !== null)
    .map((n) => RRULE_NUM_TO_CODE[n])
    .filter((c): c is WeekdayCode => Boolean(c));

  return {
    weekdays,
    seasonStart: opts.dtstart ? utcDateToYmd(opts.dtstart) : "",
    seasonEnd: opts.until ? utcDateToYmd(opts.until) : undefined,
  };
}

function formatTime(hm: string): string {
  const [hStr, mStr] = hm.split(":");
  const h = Number(hStr);
  const m = mStr ?? "00";
  if (!Number.isFinite(h)) return hm;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

function formatOccurrence(date: Date, hm: string): string {
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const mo = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][date.getUTCMonth()];
  return `${wd}, ${mo} ${date.getUTCDate()} · ${formatTime(hm)}`;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Human-readable labels for the next `n` upcoming slots (from today): each
// recurrence date expanded across all start times, in chronological order.
// Display only — no timezone conversion (that's Sprint D's concern).
export function previewOccurrences(
  rruleText: string,
  times: string[],
  n = 6,
): string[] {
  if (!rruleText || times.length === 0) return [];
  let rule;
  try {
    rule = rrulestr(rruleText);
  } catch {
    return [];
  }
  const sorted = [...times].filter((t) => TIME_RE.test(t)).sort();
  if (sorted.length === 0) return [];
  const now = new Date();
  // Cursor just before UTC-today so an occurrence falling on today is included.
  let cursor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 1,
  );
  const labels: string[] = [];
  while (labels.length < n) {
    const next = rule.after(cursor, false);
    if (!next) break;
    cursor = next;
    for (const t of sorted) {
      labels.push(formatOccurrence(next, t));
      if (labels.length >= n) break;
    }
  }
  return labels;
}

// Inclusive list of "HH:MM" times from `from` to `to` every `stepMinutes`.
// Powers the schedule form's "fill every N min" generator. Returns [] on
// invalid input (bad time format, non-positive step, or to < from).
export function timeRange(
  from: string,
  to: string,
  stepMinutes: number,
): string[] {
  if (
    !TIME_RE.test(from) ||
    !TIME_RE.test(to) ||
    !Number.isInteger(stepMinutes) ||
    stepMinutes <= 0
  ) {
    return [];
  }
  const toMinutes = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = toMinutes(from);
  const end = toMinutes(to);
  if (end < start) return [];
  const out: string[] = [];
  for (let t = start; t <= end; t += stepMinutes) {
    out.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  }
  return out;
}
