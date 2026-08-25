-- Distinguish platform fee RECOVERED FROM THE OPERATOR from platform fee forgone.
--
-- When our 6% rises after checkout and the card top-up fails, the shortfall drops into the balance
-- the customer settles at the venue — so the operator physically collects our money in cash. Once
-- that has happened the fee is not the customer's to pay again; it is the operator's to remit, and
-- charging the card would take it twice.
--
-- Until now the report offered only "write off", which records the money as FORGONE. Using it for
-- money we then recover from the operator would understate revenue in exactly the way
-- `platform_fee_cents` used to overstate it. So recovery gets its own two columns.
--
-- The amount stays in `platform_fee_uncollected_cents` in both cases; these columns say what
-- happened to it.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "platform_fee_billed_to_operator_at" timestamp with time zone;

-- The Stripe invoice item on the operator's PLATFORM customer (not their connected account). It sits
-- pending until their next retainer invoice is created, then rides along on it automatically.
-- Recorded so the charge can be traced back to the booking that produced it.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "platform_fee_operator_invoice_item_id" text;

-- The report asks for rows that are outstanding AND neither written off nor billed onward.
DROP INDEX IF EXISTS "bookings_fee_uncollected_idx";
CREATE INDEX IF NOT EXISTS "bookings_fee_uncollected_idx"
  ON "bookings" ("location_id")
  WHERE "platform_fee_uncollected_cents" > 0
    AND "platform_fee_written_off_at" IS NULL
    AND "platform_fee_billed_to_operator_at" IS NULL;
