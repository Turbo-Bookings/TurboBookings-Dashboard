-- What closed THIS booking, as opposed to what discovered the customer.
--
-- `customers.first_attribution_click_id/type` already exist and are set on INSERT only, so they hold
-- the click that first brought a person to us. That is discovery, and it happens once per PERSON.
--
-- Conversion happens once per PURCHASE. A customer can be discovered through Meta in June and close a
-- second booking through a Google branded search in September, and the two facts are both true and
-- both worth keeping. There has been nowhere to put the second one — which is why the cockpit's `ref`
-- column has always been fed from the first-touch field regardless of what actually closed the sale.
--
-- These two columns are not new design. `CROSS_SYSTEM_EVENT_CONTRACT.md` §4 has specified
-- `last_attribution_click_id` / `last_attribution_click_type` alongside the first-click pair since it
-- was written; only the first half was ever built.
--
-- Why it matters for spend decisions: judged on last click alone, a platform that CREATES demand looks
-- weak and gets defunded, and then the platform that CLOSES collapses too because nothing is filling
-- the funnel. Holding both bases is what makes that visible before the budget is cut.
--
-- Nullable with no default and no backfill: attribution is forward-only. A null means organic, direct,
-- or a click we could not capture — never zero.
--
-- Hand-written with IF NOT EXISTS and applied directly, like 0033-0039. The drizzle journal ends at
-- 0032, so `db:generate` would try to re-create everything since.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "last_attribution_click_id" text,
  ADD COLUMN IF NOT EXISTS "last_attribution_click_type" text;
