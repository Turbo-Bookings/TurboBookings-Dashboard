-- The no-show call list as a workflow, not a list that only ever grows.
--
-- Today nothing takes anyone off it. Houston has 25 bookings logged `deposit_forfeited` -- the rep
-- has been told no -- still sitting in the queue, and there is no due date, no attempt cap, no closed
-- state and no ordering beyond tour date. A $172 unpaid sits below an $86 one purely by age.
--
-- Hand-written with IF NOT EXISTS and applied directly, like 0033-0043.

-- ---------------------------------------------------------------- 1. "they said no"
--
-- Reps currently log a refusal as `deposit_forfeited` because it is the closest thing on offer --
-- seen live as "Refused to rebook" and "Won't be able to make and doesn't have any to rebook". Those
-- are two different facts and only one of them is about money.
--
-- ADD VALUE is safe here only because nothing in THIS file uses the literal: Postgres forbids using
-- an enum value added in the same transaction.
ALTER TYPE "followup_status" ADD VALUE IF NOT EXISTS 'refused';

-- ---------------------------------------------------------------- 2. the case
--
-- `booking_followups` stays APPEND-ONLY -- that is its contract, and "no answer after two attempts"
-- is a fact about two rows. Due dates and closure are mutable per-case state; putting them on the
-- log would mean UPDATE on a table whose correctness depends on never being updated.
--
-- Only what CANNOT be derived lives here. Attempts are count(booking_followups). Won-back is
-- EXISTS(booking_reschedules ...). A refusal is EXISTS(a followup with a terminal status). Storing
-- any of those creates a second copy that drifts -- which is the bug this whole phase came from.
--
-- Keyed on (booking_id, for_starts_at), not booking_id: a booking can no-show, be won back, and
-- no-show again on the new date. That is two calls to make, so it is two cases.
--
-- Rows are created LAZILY, on the first snooze or manual close. A booking with no row here is a new,
-- untouched case -- so this needs no backfill and the list works with the table empty.
DO $$ BEGIN
  CREATE TYPE "no_show_close_reason" AS ENUM (
    'not_worth_chasing',
    'bad_contact',
    'duplicate',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "no_show_cases" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"        uuid NOT NULL REFERENCES "bookings"("id")  ON DELETE CASCADE,
  "location_id"       uuid NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  -- WHICH miss this case is about. Snapshotted, like booking_reschedules.from_starts_at, so cleaning
  -- an old slot off the schedule cannot orphan it.
  "for_starts_at"     timestamp with time zone NOT NULL,
  -- When the rep said they would try again. Null = no commitment made.
  "next_follow_up_at" timestamp with time zone,
  -- A rep closing the case by hand. Automatic closures (won back, refused, 3 attempts) are DERIVED
  -- and deliberately not stored -- see noShowCase.ts.
  "closed_at"         timestamp with time zone,
  "closed_reason"     "no_show_close_reason",
  "closed_by_user_id" text,
  -- The one piece of state a pure function cannot derive: a reopened case still has >= 3 attempts
  -- behind it, so without this it would auto-close again on the next render.
  "reopened_at"       timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "no_show_cases_occurrence_idx"
  ON "no_show_cases" ("booking_id", "for_starts_at");
CREATE INDEX IF NOT EXISTS "no_show_cases_queue_idx"
  ON "no_show_cases" ("location_id", "next_follow_up_at");
