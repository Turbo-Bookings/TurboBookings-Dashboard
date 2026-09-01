/**
 * What state a no-show case is in, and where it belongs in the queue.
 *
 * A pure function over facts that live elsewhere — attempts in `booking_followups`, win-backs in
 * `booking_reschedules`, and the one genuinely mutable bit (a due date, a manual close) in
 * `no_show_cases`. Nothing here is stored, because a stored status is a second copy that drifts, and
 * that is precisely how the no-shows report came to say 2 while the reschedules report said 17.
 *
 * Not `server-only`: the report rows are a client component and need the same labels.
 *
 * ## Why EXISTS and COUNT, never "the latest row"
 *
 * The old report decided the outcome from the LATEST follow-up. That is wrong in a way that keeps
 * biting: a rep logging "no answer" after "deposit forfeited" would silently reopen a settled case,
 * and a stray "Other" after a "Rescheduled" would un-count a win-back. Terminal outcomes are tested
 * with EXISTS and attempts with COUNT, so the order rows arrive in cannot change the answer.
 */

/** Statuses that mean somebody actually tried to make contact. Three of these closes a case. */
export const CONTACT_ATTEMPT_STATUSES = [
  "left_voicemail",
  "no_answer",
  "reached",
] as const;

/** Statuses that mean the answer is no. One of these closes a case immediately. */
export const TERMINAL_STATUSES = ["deposit_forfeited", "refused"] as const;

/** Operator-chosen: three tries and the case leaves the working queue. */
export const MAX_ATTEMPTS = 3;

/**
 * Why a rep closed a case by hand. Lives here rather than beside the action because a `"use server"`
 * module may only export async functions — every non-function export has to sit in a plain module.
 */
export const NO_SHOW_CLOSE_REASONS = [
  { key: "not_worth_chasing", label: "Not worth chasing" },
  { key: "bad_contact", label: "Bad contact details" },
  { key: "duplicate", label: "Duplicate" },
  { key: "other", label: "Other" },
] as const;
export type NoShowCloseReason = (typeof NO_SHOW_CLOSE_REASONS)[number]["key"];

export type CaseOutcome =
  | "open"
  | "won_back"
  | "closed_refused" // they said no
  | "closed_max_attempts" // three tries, nobody home
  | "closed_manual"; // a rep closed it by hand

export type QueueBucket = "overdue" | "due_today" | "new" | "working" | "closed";

export type CaseFacts = {
  /** A qualifying move exists for this occurrence — see `winBacks`. */
  wonBack: boolean;
  /** Every follow-up on this booking, oldest or newest first, order does not matter. */
  followUps: { status: string; createdAt: Date }[];
  /** The `no_show_cases` row, when one has been created. */
  caseRow: { nextFollowUpAt: Date | null; closedAt: Date | null; reopenedAt: Date | null } | null;
};

export type CaseState = {
  outcome: CaseOutcome;
  bucket: QueueBucket;
  /** Contact attempts that count toward the cap — reset by a reopen. */
  attempts: number;
  nextFollowUpAt: Date | null;
  isClosed: boolean;
};

/**
 * Resolve a case.
 *
 * Precedence matters and is deliberate — first hit wins:
 *
 *   1. won back      the goal was achieved; nothing else about it is interesting
 *   2. refused       they told us no; attempts left is irrelevant
 *   3. manual close  a rep judged it not worth chasing
 *   4. 3 attempts    nobody home
 *   5. open
 */
export function resolveCase(
  facts: CaseFacts,
  now: Date,
  tzOffsetDayKey: (d: Date) => string,
): CaseState {
  const { wonBack, followUps, caseRow } = facts;

  // Attempts are counted from the reopen, if there was one. A reopened case still has its old
  // attempts on file and would otherwise auto-close again the moment it rendered.
  const since = caseRow?.reopenedAt ?? null;
  const counted = followUps.filter(
    (f) =>
      (CONTACT_ATTEMPT_STATUSES as readonly string[]).includes(f.status) &&
      (!since || f.createdAt > since),
  );
  const attempts = counted.length;

  // EXISTS, not "latest" — see the note at the top. A refusal after a reopen is still a refusal.
  const refused = followUps.some(
    (f) =>
      (TERMINAL_STATUSES as readonly string[]).includes(f.status) &&
      (!since || f.createdAt > since),
  );

  const nextFollowUpAt = caseRow?.nextFollowUpAt ?? null;

  let outcome: CaseOutcome;
  if (wonBack) outcome = "won_back";
  else if (refused) outcome = "closed_refused";
  else if (caseRow?.closedAt && (!since || caseRow.closedAt > since)) outcome = "closed_manual";
  else if (attempts >= MAX_ATTEMPTS) outcome = "closed_max_attempts";
  else outcome = "open";

  const isClosed = outcome !== "open";

  let bucket: QueueBucket;
  if (isClosed) bucket = "closed";
  else if (nextFollowUpAt && nextFollowUpAt.getTime() < now.getTime()) bucket = "overdue";
  else if (nextFollowUpAt && tzOffsetDayKey(nextFollowUpAt) === tzOffsetDayKey(now))
    bucket = "due_today";
  else if (attempts === 0) bucket = "new";
  else bucket = "working";

  return { outcome, bucket, attempts, nextFollowUpAt, isClosed };
}

/**
 * Queue order. Overdue first, then today's commitments, then never-contacted.
 *
 * The list was sorted by tour date alone, so a $172 unpaid sat below an $86 one purely by age and a
 * promised callback had no way to surface. Within a bucket the old rule stands — oldest missed tour
 * first, because the longest-cold lead is the one most worth calling before it goes further.
 */
export const BUCKET_ORDER: Record<QueueBucket, number> = {
  overdue: 0,
  due_today: 1,
  new: 2,
  working: 3,
  closed: 4,
};

export const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  open: "Open",
  won_back: "Won back",
  closed_refused: "Refused",
  closed_max_attempts: `Closed — ${MAX_ATTEMPTS} attempts`,
  closed_manual: "Closed",
};

export const BUCKET_LABEL: Record<QueueBucket, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  new: "Not called yet",
  working: "In progress",
  closed: "Closed",
};
