-- A location is not necessarily an ATV company.
--
-- Everything about a site is currently ATV-shaped: the fork writes repos named
-- "<slug>-atv-rentals-site", the storefront says "tour" throughout, and the one template is Miami's
-- live ATV site. The next operators are yacht charters, jetski rentals, guided excursions and
-- fishing charters, and none of that vocabulary fits them.
--
-- Two separate axes, deliberately not one column:
--
--   vertical         WHAT the operator sells. Drives vocabulary and schema.org type. Adding a fifth
--                    vertical is a row of copy, not a new repo.
--   template_layout  WHICH page structure the site is built on. Several verticals share a layout —
--                    yacht and fishing charters are both vessel_charter — so the operator gets a
--                    site that does not look like a copy of every other client, without us
--                    maintaining one codebase per vertical (which is the seven-copies problem this
--                    estate already learned the hard way).
--
-- Both default to the ATV shape, so the three live locations are unaffected and nothing has to be
-- backfilled.
--
-- Hand-written with IF NOT EXISTS and applied directly, like 0033-0045.

DO $$ BEGIN
  CREATE TYPE "location_vertical" AS ENUM (
    'atv',
    'jetski',
    'yacht_charter',
    'fishing_charter',
    'excursion'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "template_layout" AS ENUM (
    'tour_operator',
    'vessel_charter',
    'equipment_rental'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "vertical" "location_vertical" NOT NULL DEFAULT 'atv';

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "template_layout" "template_layout" NOT NULL DEFAULT 'tour_operator';

-- The unit an operator sells, in their own words, singular and plural.
--
-- NOT derived from `vertical` in code, because operators inside one vertical disagree: an ATV shop
-- sells "ATVs", a side-by-side shop sells "buggies", and Houston sells both. A default per vertical
-- is applied at fork time and the operator can then say what they actually call the thing.
-- NULL means "use the vertical's default" rather than "blank".
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "unit_noun" text;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "unit_noun_plural" text;

COMMENT ON COLUMN "locations"."vertical" IS
  'What the operator sells. Drives site vocabulary and schema.org type.';
COMMENT ON COLUMN "locations"."template_layout" IS
  'Which page structure the marketing site is built on. Many verticals share one layout.';
COMMENT ON COLUMN "locations"."unit_noun" IS
  'What this operator calls one sellable unit (ATV, buggy, jetski, vessel, seat). NULL = vertical default.';
