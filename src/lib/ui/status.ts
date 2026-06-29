// Shared color tokens so status is consistently color-coded across the OS.
// Pill styles use ring-inset so they read clearly in light + dark.

export type Tone =
  | "emerald"
  | "amber"
  | "red"
  | "zinc"
  | "blue"
  | "orange"
  | "violet";

export const TONE_PILL: Record<Tone, string> = {
  emerald: "bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
  amber: "bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
  red: "bg-red-100 text-red-700 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-900",
  zinc: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  blue: "bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-900",
  orange: "bg-orange-100 text-orange-700 ring-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-900",
  violet: "bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900",
};

// Soft accent backgrounds for stat tiles / icon chips.
export const TONE_SOFT: Record<Tone, string> = {
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400",
  red: "bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400",
  zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400",
  orange: "bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400",
};

export type BookingStatus = "active" | "cancelled" | "refunded";
export function bookingTone(status: string): Tone {
  if (status === "active") return "emerald";
  if (status === "refunded") return "red";
  return "zinc"; // cancelled
}

export type CheckIn = "not_yet" | "checked_in" | "no_show" | "partial";
export function checkInTone(status: string): Tone {
  if (status === "checked_in") return "emerald";
  if (status === "no_show") return "red";
  if (status === "partial" || status === "mixed") return "amber";
  return "zinc"; // not_yet
}
export function checkInLabel(status: string): string {
  return (
    {
      not_yet: "Not yet",
      checked_in: "All checked in",
      no_show: "No-show",
      partial: "Partially checked in",
      mixed: "Partially checked in",
    }[status] ?? status
  );
}
