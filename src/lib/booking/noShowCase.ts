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
 * Hours between attempts. The first is due the instant someone is marked a no-show; each one after
 * that falls 24 hours after the PREVIOUS attempt was logged, not on a fixed clock from the mark.
 *
 * Anchoring to the last attempt is what "24 hour intervals" means for a call cadence, and it is the
 * robust reading: anchoring to the mark would make a rep returning after two days off find every
 * case simultaneously two attempts overdue, which tells them nothing about what to do first.
 */
export const FOLLOW_UP_INTERVAL_HOURS = 24;

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
  caseRow: { noShowMarkedAt: Date | null; closedAt: Date | null; reopenedAt: Date | null } | null;
  /**
   * When the tour they missed started. The fallback anchor for the first attempt on occurrences
   * marked before `no_show_marked_at` existed — the tour has already run, so they read as due now,
   * which is exactly what an untouched backlog is.
   */
  missedStartsAt: Date;
};

export type CaseState = {
  outcome: CaseOutcome;
  bucket: QueueBucket;
  /** Contact attempts that count toward the cap — reset by a reopen. */
  attempts: number;
  /**
   * When the next attempt is due. DERIVED, never stored and never chosen by a rep: the mark for the
   * first, then 24h after each logged attempt. Null once the case is closed.
   */
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

  let outcome: CaseOutcome;
  if (wonBack) outcome = "won_back";
  else if (refused) outcome = "closed_refused";
  else if (caseRow?.closedAt && (!since || caseRow.closedAt > since)) outcome = "closed_manual";
  else if (attempts >= MAX_ATTEMPTS) outcome = "closed_max_attempts";
  else outcome = "open";

  const isClosed = outcome !== "open";

  // The cadence. First attempt is due at the mark; every one after that 24h from the previous
  // attempt. A closed case has nothing due.
  let nextFollowUpAt: Date | null = null;
  if (!isClosed) {
    if (attempts === 0) {
      // A reopen restarts the clock. Otherwise the first attempt is due at the mark, falling back to
      // the missed tour's own start for occurrences marked before 0045 recorded one.
      nextFollowUpAt =
        caseRow?.reopenedAt ?? caseRow?.noShowMarkedAt ?? facts.missedStartsAt;
    } else {
      const last = counted.reduce(
        (max, f) => (f.createdAt > max ? f.createdAt : max),
        counted[0].createdAt,
      );
      nextFollowUpAt = new Date(
        last.getTime() + FOLLOW_UP_INTERVAL_HOURS * 60 * 60 * 1000,
      );
    }
  }

  let bucket: QueueBucket;
  if (isClosed) bucket = "closed";
  else if (nextFollowUpAt && nextFollowUpAt.getTime() < now.getTime())
    // Never contacted and already past the mark is still "not called yet" to a rep — it is the
    // freshest lead, not a broken promise. Overdue is reserved for a cadence that has slipped.
    bucket = attempts === 0 ? "new" : "overdue";
  else if (nextFollowUpAt && tzOffsetDayKey(nextFollowUpAt) === tzOffsetDayKey(now))
    bucket = "due_today";
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
  working: "Next attempt scheduled",
  closed: "Closed",
};
