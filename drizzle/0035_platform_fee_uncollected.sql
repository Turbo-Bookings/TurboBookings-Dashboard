-- Split the platform fee into what we RECEIVED and what we were owed but could not take.
--
-- `platform_fee_cents` was recording the amount OWED regardless of whether the top-up charge landed,
-- so every revenue figure reading it overstated. On 2026-08-24 the gap was $649.80 across 30
-- bookings, none of them collected.
--
-- The gap opens when a booking's value rises after checkout — a cross-tour reschedule, an ATV added
-- at check-in — because the original charge's `application_fee_amount` settled long ago and cannot be
-- amended. The top-up then needs a saved card, and roughly 90% of the backlog has none:
--   * FareHarbor CSV imports have no Stripe payment at all and never will
--   * customers who paid by Link / Cash App / Klarna leave no reusable card (only 1 of 60 Link
--     payments produced one, against 113 of 113 for plain card payments)
--
-- So `platform_fee_cents` now means money received, and the shortfall lives beside it where it can be
-- seen, retried, or written off — rather than quietly inflating revenue.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "platform_fee_uncollected_cents" integer DEFAULT 0 NOT NULL;

-- Set when an operator accepts the amount will never be recovered, so it stops showing as
-- outstanding work. Nullable: NULL means "still owed", a timestamp means "written off, and when".
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "platform_fee_written_off_at" timestamp with time zone;

-- Partial index: the report only ever asks for rows with an outstanding, not-yet-written-off balance,
-- which is a tiny fraction of the table.
CREATE INDEX IF NOT EXISTS "bookings_fee_uncollected_idx"
  ON "bookings" ("location_id")
  WHERE "platform_fee_uncollected_cents" > 0 AND "platform_fee_written_off_at" IS NULL;
