-- Per-person fee the VENUE collects in cash (park admission, gate fee).
-- Not ours: excluded from the platform fee base, untaxed by us, never
-- discounted. Present in the quote only so the customer-facing total is true.
-- 0 (the default) hides the line, so this is a no-op for every existing
-- location until an operator sets one.
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "venue_fee_per_person_cents" integer DEFAULT 0 NOT NULL;
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "venue_fee_label" text;

-- Display-only checkout field. Collects nothing and can never be required; it
-- lets an operator place explanatory text in the flow without dressing it up
-- as a question. ADD VALUE is not transactional in older Postgres, hence its
-- own statement.
ALTER TYPE "custom_field_kind" ADD VALUE IF NOT EXISTS 'notice';

-- How many PEOPLE one unit of a customer type carries. 1 for a solo rider, 2
-- for a "Double Rider ATV". Used only by per-person money (the venue fee), not
-- by deposits — routing deposits through it would double them on live data.
ALTER TABLE "customer_types"
  ADD COLUMN IF NOT EXISTS "persons_per_unit" integer DEFAULT 1 NOT NULL;

-- Whether the platform fee is charged on the venue fee as well. Off by default:
-- the venue fee is cash the customer hands the park, so billing a percentage of
-- it is a deliberate commercial choice rather than a default.
ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "venue_fee_in_platform_fee_base" boolean DEFAULT false NOT NULL;
