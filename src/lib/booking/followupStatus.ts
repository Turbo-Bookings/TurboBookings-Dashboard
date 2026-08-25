/**
 * The outcomes a follow-up attempt can have.
 *
 * A fixed list rather than free text, because Oscar's question is "how many did we win back", and a
 * report cannot count sentences. The note beside it carries the detail — "moved to Sat 2pm", "offered
 * a free upgrade" — which is the half a dropdown cannot hold.
 *
 * Not `server-only`: the picker is a client component.
 */

export const FOLLOWUP_STATUSES = [
  { key: "left_voicemail", label: "Left voicemail", tone: "zinc" },
  { key: "no_answer", label: "No answer", tone: "zinc" },
  { key: "reached", label: "Reached — deciding", tone: "blue" },
  { key: "rescheduled", label: "Rescheduled", tone: "emerald" },
  { key: "deposit_forfeited", label: "Deposit forfeited", tone: "orange" },
  // The discrepancy case: the customer says they were there. Worth its own status because it is a
  // question about OUR records, not about the customer, and it should be countable.
  { key: "disputed", label: "Disputed — says they checked in", tone: "red" },
  { key: "other", label: "Other", tone: "zinc" },
] as const;

export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number]["key"];

export function followupLabel(key: string): string {
  return FOLLOWUP_STATUSES.find((s) => s.key === key)?.label ?? key.replace(/_/g, " ");
}

const TONE_CLASS: Record<string, string> = {
  zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  orange: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200",
  red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200",
};

export function followupToneClass(key: string): string {
  const tone = FOLLOWUP_STATUSES.find((s) => s.key === key)?.tone ?? "zinc";
  return TONE_CLASS[tone];
}
