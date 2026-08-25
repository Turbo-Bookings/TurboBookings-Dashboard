-- What a payment was FOR.
--
-- `payments` records how much and by what method, but never why — so a card taken at the desk to
-- settle a venue balance is indistinguishable from the deposit charged at checkout. The cash-to-collect
-- report exists to split exactly those two apart ("what should the till hold, versus what did we take
-- on a card"), and it cannot be computed at all without this.
--
-- Inferring it was the alternative and it does not hold: method type is 'card' for both, and
-- "captured after the booking was created" is true of any retry.
--
-- Hand-written with IF NOT EXISTS and applied directly, like 0033-0036 — the drizzle journal has
-- drifted and `db:generate` would try to re-create tables that already exist.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'deposit';

-- Backfill. Everything that exists today is a deposit except the platform-fee top-ups, which are
-- identifiable because the whole charge is our application fee — nothing else ever has
-- application_fee_cents equal to amount_cents.
UPDATE "payments"
   SET "kind" = 'fee_topup'
 WHERE "amount_cents" > 0
   AND "application_fee_cents" = "amount_cents"
   AND "kind" = 'deposit';

-- The desk-collection flow shipped 2026-08-25 and has not been used in production yet, so there is
-- nothing to backfill as 'venue_balance'. From here it is stamped at write time.

-- The cash report groups by it over a date range.
CREATE INDEX IF NOT EXISTS "payments_booking_kind_idx" ON "payments" ("booking_id", "kind");
