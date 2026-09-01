-- Win-back provenance, and what a booking was worth when it was missed.
--
-- Hand-written with IF NOT EXISTS and applied directly, like 0033-0042 — the drizzle journal stops
-- at 0032 and `db:generate` would try to recreate everything since.

-- ---------------------------------------------------------------- 1. why the booking was moved
--
-- `moveSlotBookings` writes reason = 'Slot eliminated — group move'. Those are the OPERATOR
-- cancelling a slot and sweeping its bookings elsewhere, not a rep winning anyone back, and counting
-- them inflates the one number this workflow exists to produce.
--
-- Matching that string in TypeScript would make an em-dash load-bearing: reword the reason, fix a
-- typo, translate it, and every group move silently becomes a win-back. Matched once, here, and
-- never again.
DO $$ BEGIN
  CREATE TYPE "reschedule_kind" AS ENUM ('customer', 'group_move', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "booking_reschedules"
  ADD COLUMN IF NOT EXISTS "kind" "reschedule_kind" NOT NULL DEFAULT 'customer';

UPDATE "booking_reschedules"
   SET "kind" = 'group_move'
 WHERE "kind" = 'customer'
   AND "reason" = 'Slot eliminated — group move';

-- ---------------------------------------------------------------- 2. value at the moment it was missed
--
-- A cross-tour move overwrites subtotal_cents and total_cents IN PLACE, and syncPlatformFee then
-- rewrites platform_fee_cents. So `total − fee − tax` read after a move is not the figure that was at
-- risk when the customer failed to turn up, and nothing anywhere holds that figure.
--
-- Nullable with no backfill, because for the ~350 existing rows it is genuinely unrecoverable — the
-- report says so rather than guessing. From here forward it is recorded, and in a couple of months
-- "value at risk vs value recovered" becomes answerable instead of approximated.
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "from_total_cents"        integer;
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "from_platform_fee_cents" integer;
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "from_tax_cents"          integer;

-- The win-back scan runs on the ORIGINAL missed tour date, not on created_at: a call list ranged on
-- when somebody clicked Reschedule cannot be reconciled against a list ranged on tour dates.
CREATE INDEX IF NOT EXISTS "br_winback_from_starts_idx"
  ON "booking_reschedules" ("from_starts_at" DESC)
  WHERE "from_no_show_units" > 0 AND "kind" <> 'group_move';
