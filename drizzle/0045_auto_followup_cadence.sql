-- Follow-up timing is automatic: due on the no-show mark, then every 24h, capped at 3 attempts.
--
-- 0044 shipped a rep-chosen "try again on <date>" picker. The operator's rule is simpler and does not
-- want a human deciding: the first attempt is due the moment someone is marked a no-show, and each
-- subsequent one 24 hours after the previous attempt was logged, until three have been made.
--
-- So the due date stops being state a rep sets and becomes DERIVED — the same principle the rest of
-- this workflow already follows. `resolveCase` computes it from the mark and the attempt log:
--
--     0 attempts   due = no_show_marked_at        (immediately)
--     1-2 attempts due = last attempt + 24h
--     3 attempts   closed, no due date
--
-- Hand-written with IF NOT EXISTS and applied directly, like 0033-0044.

-- When the occurrence was marked a no-show — the anchor for the first attempt.
--
-- Nothing recorded this before. `booking_lines.checked_in_at` is explicitly set to NULL when marking
-- a no-show, and the audit log is too loose to schedule work from. Written by setBookingCheckIn and
-- setLineCheckInCounts from now on; for occurrences marked before this migration it stays NULL and
-- the tour's own start time is used instead, which puts an untouched backlog immediately due —
-- correct, because it is.
ALTER TABLE "no_show_cases"
  ADD COLUMN IF NOT EXISTS "no_show_marked_at" timestamp with time zone;

-- The rep-chosen due date, removed rather than left as a dead column that invites someone to write to
-- it again. Verified empty (0 rows in the whole table) before dropping — 0044 shipped hours ago and
-- the picker was never used in production.
ALTER TABLE "no_show_cases" DROP COLUMN IF EXISTS "next_follow_up_at";

-- The queue index followed the dropped column; the useful lookup now is "cases for this location".
DROP INDEX IF EXISTS "no_show_cases_queue_idx";
CREATE INDEX IF NOT EXISTS "no_show_cases_location_idx"
  ON "no_show_cases" ("location_id", "no_show_marked_at");
