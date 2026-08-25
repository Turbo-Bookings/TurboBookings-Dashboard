-- Follow-up outreach, and reschedule history that survives.
--
-- Hand-written with IF NOT EXISTS and applied directly, like 0033-0037 — the drizzle journal has
-- drifted and `db:generate` would try to re-create tables that already exist.

-- ------------------------------------------------------------------ follow-ups
-- CREATE TYPE has no IF NOT EXISTS, so it is guarded.
DO $$ BEGIN
  CREATE TYPE "followup_status" AS ENUM (
    'left_voicemail',
    'no_answer',
    'reached',
    'rescheduled',
    'deposit_forfeited',
    'disputed',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- APPEND-ONLY. One row per outreach attempt; the report shows the latest per booking and the booking
-- shows the whole trail.
--
-- There is deliberately no `updated_at` and no update path in the app. "No answer after two attempts"
-- is a fact about two rows, and a single overwritable status column cannot express it — the second
-- call would erase the first. A correction is a new entry, which is also how you can tell who was
-- actually working the list.
--
-- `created_at` is timestamptz, unlike `bookings.created_at` and `audit_log.created_at`, which are
-- naked `timestamp` holding UTC and have to be wrapped at every call site. New tables do not inherit
-- that.
CREATE TABLE IF NOT EXISTS "booking_followups" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"  uuid NOT NULL REFERENCES "bookings"("id")  ON DELETE CASCADE,
  -- Denormalized from the booking so the per-location, per-range report does not join through
  -- bookings to filter. A booking never changes location.
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "status"      "followup_status" NOT NULL,
  "note"        text,
  "user_id"     text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "booking_followups_booking_idx"
  ON "booking_followups" ("booking_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "booking_followups_location_created_idx"
  ON "booking_followups" ("location_id", "created_at" DESC);

-- ------------------------------------------------- reschedule history snapshot
-- `booking_reschedules` stored only FK pointers at slots, and `actions/availability.ts` DELETES every
-- row pointing at a slot before dropping it — it has to, because the FKs are ON DELETE RESTRICT. So
-- routine schedule cleanup silently erases the win-back history, worst for the oldest records, which
-- is exactly what a win-back trend needs. Snapshot the facts and the pointers stop mattering.
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "from_starts_at" timestamp with time zone;
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "to_starts_at"   timestamp with time zone;
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "from_item_name" text;
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "to_item_name"   text;

-- Check-in state AT THE MOMENT OF THE MOVE. Raw counts rather than a `was_no_show` boolean: the
-- interesting case for the disputed/discrepancy flag is "partial" — some units checked in AND some
-- marked no-show — which a boolean cannot express. Feeding these to the same bookingRollup() the live
-- screens use means the two can never disagree.
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "from_quantity"         integer NOT NULL DEFAULT 0;
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "from_checked_in_units" integer NOT NULL DEFAULT 0;
ALTER TABLE "booking_reschedules" ADD COLUMN IF NOT EXISTS "from_no_show_units"    integer NOT NULL DEFAULT 0;

-- The win-back report leads on these.
CREATE INDEX IF NOT EXISTS "br_no_show_idx"
  ON "booking_reschedules" ("booking_id") WHERE "from_no_show_units" > 0;
CREATE INDEX IF NOT EXISTS "br_created_idx" ON "booking_reschedules" ("created_at" DESC);

-- Backfill the snapshots while the pointers still resolve.
UPDATE "booking_reschedules" r
   SET "from_starts_at" = a."starts_at", "from_item_name" = i."name"
  FROM "availabilities" a JOIN "items" i ON i."id" = a."item_id"
 WHERE a."id" = r."from_availability_id" AND r."from_starts_at" IS NULL;
UPDATE "booking_reschedules" r
   SET "to_starts_at" = a."starts_at", "to_item_name" = i."name"
  FROM "availabilities" a JOIN "items" i ON i."id" = a."item_id"
 WHERE a."id" = r."to_availability_id" AND r."to_starts_at" IS NULL;

-- With the facts snapshotted, a slot deletion no longer needs to take the history with it.
ALTER TABLE "booking_reschedules" ALTER COLUMN "from_availability_id" DROP NOT NULL;
ALTER TABLE "booking_reschedules" ALTER COLUMN "to_availability_id"   DROP NOT NULL;
ALTER TABLE "booking_reschedules"
  DROP CONSTRAINT IF EXISTS "booking_reschedules_from_availability_id_availabilities_id_fk";
ALTER TABLE "booking_reschedules"
  ADD CONSTRAINT "booking_reschedules_from_availability_id_availabilities_id_fk"
  FOREIGN KEY ("from_availability_id") REFERENCES "public"."availabilities"("id") ON DELETE SET NULL;
ALTER TABLE "booking_reschedules"
  DROP CONSTRAINT IF EXISTS "booking_reschedules_to_availability_id_availabilities_id_fk";
ALTER TABLE "booking_reschedules"
  ADD CONSTRAINT "booking_reschedules_to_availability_id_availabilities_id_fk"
  FOREIGN KEY ("to_availability_id") REFERENCES "public"."availabilities"("id") ON DELETE SET NULL;
