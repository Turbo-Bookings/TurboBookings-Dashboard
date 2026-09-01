-- A comment thread on a booking, writable by front-line staff.
--
-- Reported as "we cannot comment on reservations that have already passed". There is no date guard
-- anywhere — `setBookingNote` and `addFollowUp` never look at the tour date or the booking status.
-- The real block is the capability: both are gated on `manage_bookings`, which is director+, so
-- front-line staff (`basic_user`) see the note read-only on EVERY booking, past and future alike.
--
-- ## Why this is not a booking_followups row
--
-- `booking_followups.status` is NOT NULL and every value in that enum is something a report counts.
-- A plain comment would have to pick one, and `noShowReport` reads the LATEST followup per booking to
-- decide the call-list outcome — so a rep typing "customer says they were there" after logging
-- "Rescheduled" would silently overwrite the outcome and un-count a win-back. That is the same
-- "latest row decides" fragility behind the 2-vs-17 discrepancy; it must not be given a second way in.
--
-- ## Why this is not bookings.notes
--
-- That is ONE mutable text field with no author and no timestamp, last writer wins. It stays exactly
-- as it is — the single line check-in reads at the desk — and keeps its manage_bookings gate, because
-- a shared overwritable field is the wrong thing to hand to a whole shift.
--
-- Append-only, for the same reason booking_followups is: an edited comment is a record of nothing.
-- There is deliberately no updated_at and no update path.
--
-- Hand-written with IF NOT EXISTS and applied directly, like 0033-0041 — the drizzle journal stops
-- at 0032 and `db:generate` would try to recreate everything since.
CREATE TABLE IF NOT EXISTS "booking_comments" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "booking_id"  uuid NOT NULL REFERENCES "bookings"("id")  ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "locations"("id") ON DELETE CASCADE,
  "body"        text NOT NULL,
  -- Clerk user_id of whoever wrote it. Nullable for system-written rows, matching booking_followups.
  "user_id"     text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

-- The thread on one booking, newest first — the only read this table has.
CREATE INDEX IF NOT EXISTS "booking_comments_booking_idx"
  ON "booking_comments" ("booking_id", "created_at" DESC);
