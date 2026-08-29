# Custom Booking System — Sprint Roadmap (reconstructed 2026-05-30)

> ## ⭐ SINGLE SOURCE OF TRUTH — RESUME HERE
> This file is the canonical build-status + sequencing roadmap for the custom booking system across
> **BOTH** repos. If anything elsewhere disagrees on build **ORDER**, this file wins.
>
> ---
> ### ▶ STATE AS OF 2026-08-28 (later) — inventory feed live
>
> The cockpit now receives hourly physical-capacity snapshots. It previously steered spend with no idea
> whether a market had anything left to sell.
>
> | Piece | Where |
> |---|---|
> | Structural fill per tour day-of-week × daypart | `src/lib/inventory/structural.ts` |
> | Near-term sellable capacity, horizon derived per market | `src/lib/inventory/nearTerm.ts` |
> | Lead time + booking-day → tour-day matrix | `src/lib/inventory/leadTime.ts` |
> | Blocked tours (a pool with zero serviceable units) | `src/lib/inventory/fleet.ts` |
> | Hourly emit | `src/app/api/cron/inventory-snapshot/route.ts`, `0 * * * *` |
> | Receiver + store | `~/ads/SHARED/cockpit/inventory.py` (its own `inventory.db`) |
>
> #### Consumption side — 6 of 7 steps done (updated 2026-08-29)
>
> | Step | Piece | State |
> |---|---|---|
> | 1 | Compute + emit hourly | ✅ live |
> | 2 | `inventory.summary()` — downsampled view | ✅ live, 15 tests |
> | 3 | `pack["inventory"]` in the fact pack | ✅ live |
> | 4 | `capacity` key on `efficiency()` | ✅ live |
> | 5 | Freshness recomputed at READ (the pack caches 12h) | ✅ live, verified |
> | 6 | Capacity-stale alert, below revenue-stale | ✅ live |
> | **7** | **Analyst prompt — `cockpit/analyst.py::_SYSTEM`** | ⛔ **NOT WRITTEN** |
>
> ⛔ **The model still has no idea inventory exists.** Steps 3–6 are inert plumbing by design; nothing
> reaches the analyst until the feed has run a clean 24h. **Step 7 is the entire remaining scope of
> this phase.** It must say: physical capacity ≠ media headroom; **veto only** (may block or downgrade
> a scale, never justify one, never justify a cut); an empty near-term slot is NORMAL, not weak demand;
> and a tour-day shortage may never become a serving-day bid change.
>
> ⚠️ **Also decide `booking_timing_heatmap` in that same pass** — computed, shipped in every fact pack,
> read by nothing. Recommendation: drop it from the pack, keep the function. Full reasoning in the feed
> doc. Doing nothing is the bad option — a second dead fact makes the pack look decorative.
>
> #### A fourth measurement bug, caught by an invariant test
> `peak_units_max` was the max across days while `binding_resource_name` was the most FREQUENT across
> days — different pools. Houston reported a **peak of 8 against a "UTV" fleet of 1**. Not a
> double-count; the two fields simply described different things while inviting comparison. Fixed by
> accumulating per resource (`structural.ts`) and now asserted by `scripts/check-inventory-snapshot.ts`.
> **Run that script after any change to the producer.** All 63 cells across three markets pass.
>
> #### The feed caught a real-world repair unprompted
> Miami's UTV pool went **0/4 → 3/4 serviceable** overnight 2026-08-29 (`updated_at 03:34`). The 203
> blocked slots are largely resolved. Nobody told the system; it observed it.
>
> #### Three measurement bugs the verification gate caught, all of which had been stated as fact
> 1. An inner join on bookings averaged only slots that HAD bookings → "Dallas Saturdays run 72% full".
> 2. Correcting that gave 23%, which was worse: Dallas's schedule was materialised 2026-06-28 but its
>    first own booking landed 2026-08-18, so seven weeks of unbookable slots were in the denominator.
>    **Pre-launch slots are not weak demand.** Floored at go-live it reads ~70–74%, matching the operator.
> 3. The near-term slot filter was `eq(status,'on')` when the default is `'auto'` — silently dropping
>    almost all inventory. Dallas read as 3 slots on a Saturday that has 14.
>
> #### Facts worth not re-deriving
> * All three markets went live **2026-08-18..21**, so `structural.confidence` is `none` until ~November.
> * Median booking lead time: **0.2d htown, 0.3d miami, 1.2–1.7d dtown.** A slot 3 days out being empty
>   is the base case, not weak demand.
> * Dallas sends **15.9% of all bookings from Thursday to Saturday tours**. Serving-day bids
>   (`set_ad_schedule`) must never be inferred from a tour-day shortage — see the feed doc.
> * Miami's UTV pool was **4 units, 4 out of service** (two tours unsellable, 203 slots over 7 days);
>   **3 of 4 were repaired overnight 2026-08-29.** Kept here because it is the worked example of
>   why `blocked_items` is the sharpest signal in the payload — spend was reaching unsellable tours.
> * Dallas ran **24 ATVs against 22 serviceable** on Aug 22 — either the out-of-service count is stale
>   or it genuinely oversold. Worth confirming; the near-term half divides by serviceable.
>
> ---
> ### ▶ CORRECTION 2026-08-28 — there are TWO Replit projects
>
> `~/takeovers-platform` is **Miami only**: hardcoded Aircall number, business identity and pickup
> address, no tenant column, last application commit 2026-04-26. **Dallas and Houston run on a
> SECOND, separate Replit project with its own GitHub repo**, not cloned locally.
>
> A session reading only the local clone concluded Dallas and Houston had no phone/SMS system at all.
> **That was wrong.** Any figure taken from `~/takeovers-platform` — call counts, SMS threads,
> transcript coverage — describes Miami and nothing else.
>
> **Open:** the second project's GitHub repo is not currently visible in the account; it may need
> re-pushing from Replit before it can be read, planned against, or migrated to Railway. Until then
> the Dallas/Houston side of the receptionist is undocumented here, and the Railway rebuild cannot be
> scoped accurately — it has to replace BOTH projects, not one.
>
> ---
> ### ▶ STATE AS OF 2026-08-28 — attribution on two bases, TikTok-ready
>
> Project **#25 is built** — `bookings.ref` was written from 2026-08-22 and read by nothing; it is now
> read, on two bases, with TikTok in the data model before its ads launch.
>
> | Area | Change |
> |---|---|
> | **Two attribution bases** | `customers.first_attribution_click_*` = what DISCOVERED a person (once per person). New `bookings.last_attribution_click_*` (migration **0040**) = what CLOSED a booking (once per purchase). Judged on last click alone, a platform that CREATES demand looks weak, gets defunded, and the closer collapses weeks later with nothing feeding it |
> | **First-party capture** | `tb_click_first` (never overwritten) + `tb_click_last` (always overwritten), written from the landing URL by proxy. `_fbc`/`_gcl_aw` demoted to legacy fallback — they only exist if the Meta pixel and gtag both loaded and survived ITP |
> | **`ttclid`** | Captured, forwarded and mapped to `tiktok` across all repos. Attribution is forward-only, so TikTok go-live is a switch, not a deploy |
> | **`tb_aid` finally issued** | Specified in `VERCEL_PREP §3`, read side built for months, and **0 of 1,440 customers had one** because no site ever issued it. All three marketing sites now do, on the registrable domain |
> | **Dallas brought to parity** | Had no `ad-tracking.ts` and no decorator (stripped at fork in `23504b6`), so it forwarded nothing and could never capture a `gclid`. Ported, minus the FareHarbor session bridge |
> | **Cockpit** | `revenue_by_platform(basis)`, `attribution_handoffs()`, and per-platform `CAC_first`/`CAC_last`, over-claim vs the deterministic floor, and a `role_index` re-derived every window. All `advisory_only` |
>
> #### The meaning change to know about
> `ref` used to be built from the storefront's **first-touch** field, so the ledger's only attribution
> column recorded *discovery* while any consumer would read it as *conversion*. **`ref` now means the
> last click**, matching how Meta, Google and TikTok all attribute — which is what makes it comparable
> to their reported numbers. Discovery moved to `ref_first`.
>
> #### Guardrails that must not be quietly dropped
> The `unattributed` bucket is reported and **never allocated** across platforms; every figure ships
> with coverage; ratios are suppressed below **40%** coverage; everything is advisory-only, so §11a's
> directional/marginal-shift rule still governs real budget moves.
>
> ⚠️ **TikTok is reported but NOT managed.** It is deliberately absent from `platform_mix` and the
> decision engine: `rules.py` has per-platform generators, the analyst's JSON Schema pins
> `enum: ["google","meta"]` in three places, and at least six sites do `if google else <assume meta>` —
> a TikTok proposal would be silently handled as Meta rather than failing loudly. Generalising that is
> required before TikTok spend is *managed*, not before it is *measured*.
>
> ⚠️ **`BookingLinkDecorator` is the PRIMARY capture path, not dead FareHarbor code.** It was built for
> FareHarbor and it does still work; `LINKER_DOMAIN` follows the booking host. `TRACKING_CUTOVER_PLAYBOOK.md`
> used to say it "goes inert" after cutover — corrected 2026-08-28. Deleting it now deletes attribution.
>
> ---
> ### ▶ STATE AS OF 2026-08-26 — booking system **v1.5**
>
> **v1.5 — scarcity display + the Dallas Glow retime** (live on `main`)
>
> | Area | Change |
> |---|---|
> | **Per-tour "Only N left!"** | The booking widget printed the remaining count on EVERY slot — Houston advertised "65 left" under empty times, which is the opposite of urgency on the one control we want guests to act on. New `items.low_stock_threshold` (migration **0039**, default **5**, `0` = never). Above it: nothing. Editable per tour under Capacity, with the tour's real ceiling shown as help text. Display only — it can never make a slot bookable |
> | **Cap now explains itself** | Hiding the count left a dead `+` button with no stated limit. The sub-line under the steppers is now cap-triggered: *"15 is all we have left at this time"* |
> | **Dallas Glow → 45 min, Fri/Sat/Sun** | Same pricing, hourly starts. 920 unbooked future slots retimed, 7 booked slots kept at 60 minutes and closed to new sales, `default_duration_minutes → 45` |
> | **Manifest honours the old length** | A slot whose length differs from its tour's current duration shows an amber *"Originally booked for 1 hour"* badge, so the desk knows before the guest says it |
>
> #### The trap that made this look done when it wasn't
> **Changing a schedule's duration does NOT retime the slots it already made.** `materializeScheduleRow`
> matches existing rows by `startsAt` alone and inserts `onConflictDoNothing`; **nothing in either repo
> ever updates `availabilities.ends_at`.** Glow's start times didn't change, so every one of 927 future
> slots matched and kept `endsAt = start + 60`. The setting read 45 and the tours would have run an
> hour, for the full 540-day horizon. Any future duration change needs an explicit retime —
> **`scripts/retime-glow-slots.ts` is the pattern**: dry-run by default, and it never touches booked
> slots, slots with a live seat hold, or the past.
>
> **Second half of the same trap: booked slots survive a schedule change but stay SELLABLE.** Empty
> slots on dropped days are pruned automatically; booked ones are kept by design, and no read path
> checks whether a slot still matches its schedule. An orphaned Monday stays quietly bookable until
> it is closed explicitly.
>
> ⚠️ **`bookingsystem/src/lib/db/schema.ts` is a hand-maintained COPY** and its item queries use a bare
> `select()`. A column missing there is **silently dropped** — no type error, no runtime error, just a
> feature that does nothing. Mirror any new `items` / `locations` column in the same pass.
>
> ---
> ### ▶ STATE AS OF 2026-08-25 — booking system **v1.4**; roles, dashboard, reports
>
> | Phase | Change |
> |---|---|
> | **1 · Access** | New capabilities `view_revenue` (director+) and `collect_payment` (basic_user+). Bookings + dashboard opened to `checkin`; reports behind `view_revenue`. **Four unguarded server actions and three unguarded CSV routes closed**, plus six more found by audit — incl. `getTeamForLocation`, which returned every staff email at any location to any signed-in user. `assignRole` could be used by an operator to demote a peer out of their own permissions |
> | **2 · Dashboard** | Today at the venue → Sales today → Next 7 days → Last 7 days. "pax" renamed to "vehicles", which is what the number always counted |
> | **3 · Bookings** | Per-tour vehicle totals, date picker, rolling-7 view, history that names who acted |
> | **4 · Reports** | A registry — one entry + one folder per report; `npx tsx scripts/check-report-routes.ts` verifies it. Eight reports |
> | **5 · Follow-ups** | No-show call list, win-back report, append-only `booking_followups` log, and reschedule history that survives slot cleanup (`booking_reschedules` snapshot columns, FKs RESTRICT → SET NULL) |
> | **Money** | `syncPlatformFee` was **recomputing** a booking's total from its subtotal, erasing FareHarbor tax residue and custom-price overrides — it had already fired on 16 bookings. It now adjusts by the fee delta only. Operators no longer see our processing margin in a customer's breakdown |
>
> Migrations **0037–0039** are hand-written and applied directly. The drizzle journal still ends at
> `0032` — **never run `db:generate`.**
>
> ⚠️ **Win-backs are only identifiable from 2026-08-25.** The 133 backfilled reschedule rows carry zero
> check-in counts; "0 won back" for August is a gap in the record, not a business fact.
>
> ---
> ### ▶ STATE AS OF 2026-08-24 — booking system v1.3; operator tooling hardened
>
> **What shipped 2026-08-24** (all live on `main`, all in `turbobookings-dashboard` unless noted):
>
> | Area | Change |
> |---|---|
> | **Rep payments** | The charge button froze on "Charging…" and took nothing. Card-only on the rep form, `try/catch` + `finally`, `!stripe` gate, `return_url`, idempotency key. `processing` no longer reported as failure *after* money moved. Post-charge fetches timeboxed |
> | **Customer edits** | Managers (`director`+) can fix name/email/phone on a booking, with **Resend confirmation**. Email collisions re-point the booking to the existing customer |
> | **Payment country** | Dashboard defaults to US; the customer site deliberately still follows IP for overseas tourists |
> | **Booking timestamps** | "Booked …" and "Cancelled …" in location-local time, UTC-projected. `cancelled_at` previously had ZERO references in any component |
> | **Cancel/refund** | Merged into one control. The loud red button used to pay out the *policy* figure — $0.00 on a late cancellation — while the correct action sat below it looking optional |
> | **Shared resource pools** | Two tours on the same machines each saw the whole fleet. Peak-concurrency, not sum. `bookingsystem` + 7 dashboard call sites |
> | **Cross-tour reschedule** | Now allowed, with re-pricing; platform fee ratchets up and is charged to the saved card |
> | **Uncollected fees** | `platform_fee_cents` now means money RECEIVED; new report at `reports/uncollected-fees` |
> | **Dallas Glow Tour** | New tour, 1 ATV + 1 Glow Kit so the 10 kits cap it without leaving the shared ATV pool |
>
> ---
> ### ▶ PREVIOUS STATE (2026-08-22) — all three locations LIVE; cockpit revenue feed **CONNECTED**
>
> **Miami cut over 2026-08-21.** All three locations now run on our own booking system and FareHarbor
> is retired as a booking surface. `fareharbor.com` appears 0 times on the Miami marketing site.
>
> **The cockpit revenue feed is live** — the thing that had never worked. See
> **`docs/cross-system/BOOKING_TO_COCKPIT_FEED.md`** for the full contract; the short version:
>
> - New receiver `POST https://cockpit.turbobookings.net/api/webhooks/turbobookings`, HMAC-verified,
>   **fails closed**. Writes into the cockpit's existing SQLite ledger as a third `source`.
> - 355 of 362 queued events delivered. **232 bookings / $62,110 subtotal** landed
>   (dallas 127, houston 60, miami 45), and **72 carried a click id** — the first values
>   `bookings.ref` has ever held. That unblocks cockpit project **#25** (per-platform true ROAS).
> - Verified in the cockpit: `data_through: 2026-08-22`, efficiency miami 12.4% / houston 11.4% /
>   dallas 4.1% against a 10–16% target band. Dallas is materially **under**-spending.
>
> #### Three corrections that cost time — do not re-derive them
> 1. **The cockpit does NOT deploy from GitHub** (`railway status --json` → `source: None`). Pushing to
>    `main` deploys nothing. `cd ~/ads/SHARED && railway up --detach --yes`.
> 2. **Saving a Vercel env var does nothing to a running deployment.** Vars are injected at deploy
>    time. After changing one, redeploy — and target the *newest* deployment, or you roll production
>    back (this happened; `vercel deploy --prod` from a clean checkout is the unambiguous fix).
> 3. **There is no Intelligence Neon DB.** `PLATFORM_ARCHITECTURE.md` used to claim the cockpit reads
>    ROAS from one. It has no Postgres client at all — revenue is one SQLite table on the Railway
>    volume. Corrected in every copy.
>
> #### `REPLIT_WEBHOOK_*` is a fossil — nothing is ever sent FROM Replit
> It is the key OUR storefront SIGNS outbound events with, named after a receiver that was planned and
> never built. **`BRAIN_WEBHOOK_URL` / `BRAIN_WEBHOOK_SECRET` are now the real names**, read by both
> repos with the legacy names as fallback. The old vars can be deleted.
>
> #### FareHarbor data must never reach the cockpit
> Imported bookings (`external_ref` like `fh:%`) already exist there from FareHarbor's own webhook,
> under FareHarbor's pk — our dedup keys on `tb|<booking_id>` and **cannot see that collision**. Two
> locks: `emitLifecycle` skips them, and the receiver refuses any booking carrying `external_ref`.
> 136 already-queued lifecycle events were dead-lettered rather than sent. **Never make the importer
> call `emitEvent`.**
>
> #### ✅ RESOLVED 2026-08-24 — uncollected platform fees
>
> The 🔴 task logged earlier today is done. What it turned out to be:
>
> ```
> $649.80 across 26 bookings, 0 collected
>   $582.00  FareHarbor CSV imports — no Stripe payment behind them, uncollectable forever
>    $33.00  operator/phone bookings — no card saved
>    $34.80  online bookings — only ONE of seven had a usable card
> ```
>
> **The decisive finding was not the bug — it was Link.** A card payment leaves a reusable card on
> file 113 times out of 113. A **Link** payment leaves one **1 time in 60**; Cash App and Klarna, never.
> `commit.ts` guards the save with `if (pm?.card)`, and a Link PaymentMethod has no `.card`. So
> "charge the saved card" only ever works for customers who paid by plain card, and roughly 90% of
> the backlog was never chaseable.
>
> > ⚠️ **Superseded the same day, and now DISPROVEN — do not act on the paragraph above.** "1 in 60"
> > measured OUR BUG, not Link. `setup_future_usage: "off_session"` attaches a Link PaymentMethod to
> > the Stripe Customer exactly as it does a card; the `if (pm?.card)` gate then threw it away. A
> > second bug meant two thirds of payments recorded no method type at all, so even the Link *share*
> > came from the one third we could see — not a random third.
> >
> > Both are fixed, and `scripts/backfill-payment-methods.ts` recovered the truth from Stripe for the
> > 383 affected payments:
> >
> > ```
> > card 42.0%   link 32.9%   cashapp 22.5%   klarna 2.6%
> > attached to a customer, i.e. chargeable later:  337 of 383  (88%)
> > ```
> >
> > Card is only 161 of those 383, so **at least 176 of the reusable methods are Link or Cash App**.
> > Stripe had been attaching them the whole time. The backfill created **193 wallet methods on file
> > that did not exist before**, and flipped half the outstanding fees from unchaseable to retryable.
> >
> > Removing Link would have cost a third of checkouts to fix a defect of ours. **The coverage half of
> > the question is closed: keep Link.** What is still unmeasured is whether an off-session CHARGE on
> > a wallet method succeeds — see below.
>
> **Fixed:**
> - `chargeCardOnFile` omitted Stripe's `customer` parameter. Because checkout uses
>   `setup_future_usage`, every saved card IS attached to a Customer — so it failed for every real
>   card we hold. It surfaced only once because the other 29 never reached Stripe. It now resolves
>   the customer from the PaymentMethod at call time rather than requiring a new column.
> - **`platform_fee_cents` now means money RECEIVED.** It was recording what was owed regardless of
>   collection, so every revenue figure overstated by whatever failed. New
>   `platform_fee_uncollected_cents` + `platform_fee_written_off_at` (migration
>   `drizzle/0035_platform_fee_uncollected.sql`, applied by hand — the drizzle journal has drifted,
>   see below). The historical $649.80 was moved across.
> - **New report:** `/locations/<slug>/reports/uncollected-fees`, admin-only, linked from Reports.
>   Splits chaseable (has a card → Retry) from not (→ Write off). A write-off is an acknowledgement,
>   not an erasure: the amount stays recorded so the running total of what we have forgone is visible.
>
> ⚠️ **The drizzle migration journal is out of sync with production.** `0033`/`0034`/`0035` are
> hand-written and applied directly; `npm run db:generate` will try to re-create `terms_acceptances`
> and the venue-fee columns that already exist. Write new migrations by hand with `IF NOT EXISTS`
> and apply them directly until someone reconciles the journal.
>
> #### ✅ DECIDED 2026-08-24 — Link stays at checkout
>
> **Keep Link. This is settled; do not reopen it off the old numbers.**
>
> It was nearly removed on the finding that Link left a reusable payment method 1 time in 60 against
> 113 of 113 for plain card. That measured a bug of OURS — an `if (pm?.card)` gate discarded Link
> methods Stripe had already attached — compounded by a second bug that left two thirds of payments
> with no recorded method type, so even the Link *share* came from a biased third of the data.
>
> Both fixed, and the backfill recovered the truth from Stripe for all 383 affected payments:
>
> ```
> card 42.0%   link 32.9%   cashapp 22.5%   klarna 2.6%
> attached to a customer, i.e. chargeable later:  337 of 383  (88%)
> ```
>
> Card is 161 of those 383, so at least 176 of the reusable methods are wallets. Removing Link would
> have cost a third of checkouts to work around a defect we had already fixed.
>
> **The question that motivated it is now moot anyway.** There are three routes to every fee: taken at
> checkout, taken at the desk via *Collect balance* (`lib/booking/balanceCharge.ts`), or billed to the
> operator's platform invoice. Whether an off-session top-up on a wallet succeeds no longer decides
> anything — it only changes which of the three collects it.

> #### 🗓 PARKED — cross-location roll-up
>
> Every number in the dashboard is scoped to ONE location, so "how did the weekend go across the
> business" means opening three dashboards and adding up by hand. The root page lists locations with
> no figures at all. At the 5–8 locations planned this stops being something anyone does, which means
> the number stops being looked at.
>
> **Not a priority yet** — parked deliberately, not forgotten. Higher-value booking-system features
> come first.
>
> Design work already done, so a future session does not repeat it:
>
> - **Scoping is free.** `accessibleLocationIds()` already returns `"all"` for master/admin and a list
>   otherwise. Richard is an operator at BOTH dtown and htown, so he would get a genuine two-location
>   roll-up of his own business and Miami could never appear in it. No new permission model.
> - **✅ DECIDED — a cross-location "today" is each location's OWN local day**, stitched together.
>   dtown/htown are `America/Chicago`, miami is `America/New_York`, so there is no single instant that
>   is "today" everywhere. Per-location local days mean the roll-up always equals the sum of its parts
>   and drilling in reconciles — at the cost of spanning 25 real hours, which is the right trade. The
>   alternative (one absolute window) makes the owner's number disagree with the operator's own
>   dashboard for any late Glow Tour.
> - **The report registry was built for this** — `ReportDef` can carry a location-scoped vs
>   cross-location flag rather than assuming a slug.
> - **Cost is the aggregation, not the UI.** Reports currently aggregate in JS after fetching rows,
>   one location at a time. Across N locations that is N× the queries: fine for a day at three
>   locations, needs real SQL aggregates for a 30-day range at eight.
>
> Natural order if picked up: overview page first (it replaces opening three dashboards and is the
> plumbing the rest reuses), then revenue, then check-in/no-shows, then cash.

> #### 🔴 CANNOT BE FIXED — booking totals damaged by the syncPlatformFee overwrite
>
> `syncPlatformFee` used to recompute `total = subtotal + tax + fee` instead of adjusting by the fee
> delta, which erased anything else living in the total. Fixed 2026-08-25 (`platformFee.ts`), but it
> had already fired on bookings that had a vehicle or rider added at the desk.
>
> **These will not be corrected.** The originals are not recoverable from our data — FareHarbor's tax
> is not itemised in the import, and the custom prices are gone — and nobody at the locations knows
> the details of individual charges. Reconstructing them would be inventing numbers.
>
> **Do not re-investigate them as discrepancies.** Find them with:
>
> ```sql
> SELECT l.slug, b.display_number, b.external_ref IS NOT NULL AS imported,
>        b.subtotal_cents_override IS NOT NULL AS overridden
>   FROM bookings b JOIN locations l ON l.id = b.location_id
>  WHERE (b.external_ref IS NOT NULL OR b.subtotal_cents_override IS NOT NULL)
>    AND EXISTS (SELECT 1 FROM audit_log a
>                 WHERE a.action IN ('catalog.booking.add_vehicles','catalog.booking.add_line')
>                   AND a.payload->>'bookingId' = b.id::text);
> ```
>
> Roughly eleven bookings, $8–40 each. Bookings taken through our own system were unaffected — for
> those, `subtotal + tax + fee` IS the total, so recomputing it changed nothing.

> #### ✅ SHIPPED 2026-08-26 — per-tour "Only N left!" threshold
>
> The booking widget printed the remaining count under EVERY slot and used a hardcoded `<= 5` only to
> pick the styling — so Houston's 1-Hour ATV Tour advertised **"65 left"** beneath every empty time.
> That is not scarcity; it tells a guest there is no rush, on the one control we want them to act on.
>
> `items.low_stock_threshold` (migration **0039**, hand-applied, default **5**). At or below it the
> slot says `Only N left!`; above it, nothing at all; `0` disables it. Editable per tour in the tour
> catalog under Capacity.
>
> **Per tour, not per location**, because the trigger has to move with the tour's size. Live ceilings:
>
> | Tour | Ceiling |
> | --- | --- |
> | htown 1-Hour ATV / Night Glow | 65 (shared ATV pool) |
> | miami ATV tours | 35 |
> | dtown D-Town ATV | 22 |
> | dtown Night Glow | **5** (10 kits, 5 out of service) |
> | htown Four Seater Buggy | **1** |
> | miami UTV tours | **0** (all 4 UTVs out of service — deliberate, no bookings) |
>
> ⚠️ **Four tours have a ceiling at or below the default of 5**, so they say "Only N left!" on every
> slot including empty ones — dtown Night Glow, htown Buggy, and both miami UTV tours. Accurate, but
> not urgency. The tour form quotes each tour's real ceiling and warns about this; they want tuning
> down (or `0`).
>
> ⚠️ **`bookingsystem/src/lib/db/schema.ts` is a hand-maintained COPY** and `getBookableItem` uses a
> bare `select()`, so a column missing there is **silently dropped** — no type error, no runtime
> error, just a feature that quietly does nothing. Any future `items`/`locations` column needs
> mirroring there in the same pass.
>
> The stepper sub-line could not simply be deleted: it was the only thing explaining why the `+`
> button stops at `remaining`. It is now silent while there is room and shows the real figure at the
> cap — *"15 is all we have left at this time."*

> #### ⚠ Known-open
> - **7 events still retrying** — `401`/`403` from the rollout window, `attempt_count ≤ 2`. They should
>   self-heal on backoff. Check: `succeeded_at IS NULL AND attempt_count < 6 AND last_error NOT LIKE 'retired:%'`.
> - **The Railway `/data` volume is the only copy of the revenue ledger.** No backup exists.
> - **Miami's site copy says "$50" in 81 places** while the deposit is $40. Two distinct meanings —
>   reservation deposit (should track $40) vs a genuine **$50 rescheduling fee**. A blind replace
>   corrupts the second. Needs a deliberate pass across `en.json`, `es.json`, a blog post and the chatbot.
> - **Google Ads:** the FareHarbor-era `Online Booking Purchase` conversion action is still Active and
>   can never fire again — archive it. Four goals read "Misconfigured" (pre-existing).
> - **Spanish localisation** of the booking app is still unbuilt and was called out as a big conversion
>   lever for Miami.
> - **Retainers:** Dallas configured but `inactive` with no card; Houston and Miami unset. Nobody is
>   being billed.
> - **Radar Lite → Standard** on both connected accounts — free, strictly better, only Richard can do it.
>
> #### ▶▶ NEXT PHASE — Stage 3, the real Phase 0
> Intelligence DB on Neon, `touchpoints`, identity resolution, and resolving the click ids we now
> collect into **per-campaign** attribution (cockpit #25). Also fix `tb_aid`: the marketing sites never
> issue that cookie, which is why `customers.anonymous_id` is **0 of 727** and anonymous→identified
> stitching is dead.
>
> ---
> ### ▶ PREVIOUS STATE (2026-08-21) — Dallas AND Houston live; Miami next
>
> **Legal / terms work landed this session — read `docs/LEGAL_AND_TERMS.md` first.**
> The platform fee is now RETURNED on refunds (this reversed the 2026-08-18
> decision — item 2 below is rewritten, and anything else you find saying "keep
> the fee" is stale). A `terms_acceptances` record exists and is deliberately
> switched OFF until counsel delivers wording.
>
> **Shipped since Houston went live:** booking notes are writable and visible to
> check-in; the customer booking flow has named back links and a footer with the
> marketing-site link, phone and support email; `npm run location:preflight`
> checks a location before launch; `npm run terms:status` prints the acceptance
> record.
>
> **Verified healthy 2026-08-21:** transactional email is working — Dallas has
> sent 94 across all seven types with **0 overdue**, Houston 5. The old warning
> that reminders and the retainer had "never been observed working" is resolved
> for email. 5 errored sends total (1 abandoned-cart, 4 post-tour-review) are
> worth a look but are not blocking.
>
> #### ⚠ Known-open, not blocking Miami
> - **Houston reminders are NOT armed, and cannot be armed from a dev machine.**
>   317 imported bookings carry no 24h/2h reminders. Scheduling runs through the
>   booking app's authenticated internal endpoint, and `vercel env pull` returns
>   sensitive values as EMPTY STRINGS — so `INTERNAL_API_SECRET` is blank locally
>   and nothing is scheduled. A run on 2026-08-21 reported "Requested reminders
>   for 317 booking(s)" and created zero; that lie is fixed (the script now aborts
>   with the reason and reports "scheduled N of M"), but the reminders are still
>   not armed. **Put the real `INTERNAL_API_SECRET` in `.env.local` from the
>   Vercel dashboard, then run
>   `npm run import:fh -- --slug=htown --arm-reminders --commit`.**
>   Do it only once FareHarbor's own reminders are off for Houston — the bookings
>   still live in FareHarbor and it will send its own unless disabled.
> - **Cockpit revenue feed — the pipeline is BUILT; only two env vars are missing.**
>   `emit.ts` HMAC-signs an envelope and posts it, falling back to
>   `outbound_event_queue`; `/api/cron/retry-events` runs EVERY MINUTE with
>   backoff and dead-lettering, and skips cleanly when unconfigured. Set
>   `REPLIT_WEBHOOK_URL` + `REPLIT_WEBHOOK_SECRET` and it starts working.
>   (Naming drift, harmless: the dashboard reads `REPLIT_WEBHOOK_*`, the booking
>   system reads `BRAIN_WEBHOOK_* ?? REPLIT_WEBHOOK_*`.)
>   188 events are waiting — 102 `booking.created`, 49 `booking.checked_in`,
>   20 `booking.rescheduled`, 13 `booking.cancelled`, 4 `booking.no_show`, from
>   2026-06-28 onward. These are **complementary to FareHarbor's own webhook, not
>   duplicates**: they are bookings taken on OUR system plus check-in, cancel and
>   reschedule events FareHarbor never saw. Before flushing, confirm the cockpit
>   keys off the envelope's own timestamp rather than receipt time — otherwise 49
>   check-ins going back to June arrive looking like they happened today.
> - **Retainers:** Dallas configured ($3,250/mo, day 15) but `inactive` with no
>   card; Houston unset entirely. Neither client is being billed. Selmen is
>   handling.
> - **Radar Lite → Standard** on both connected accounts. Free, strictly better,
>   and only Richard can do it. See `docs/PAYMENT_RISK_AND_RADAR.md`.
> - **Dallas's GA4 property** was never checked for the leftover `fareharbor.com`
>   cross-domain entry. It is a different property from Houston's.
> - **$72 owed back to Richard** from the reversed refund term — not authorised.
>
> **Marketing-site tracking audit: `docs/MIAMI_SITE_TRACKING_AUDIT.md`** — what
> dies at cutover (one webhook route carrying four signals), what was fixed, and
> the one open unknown (the contents of GTM container GTM-PNVZ2GWD).
>
> ### ▶ MIAMI — what is different, and what will bite
>
> Miami is **not** another Houston. Three things are genuinely new:
>
> 1. **It is bilingual.** `takeovers-site` runs `locales: ["en", "es"]` with
>    `[locale]` routing. **The booking app has no locale routing at all** — a
>    Spanish-speaking visitor clicks Book and lands in English. Dallas and Houston
>    never had this. Decide before cutover whether that is acceptable for launch.
> 2. **The cutover switch is not ported.** `takeovers-site` has no
>    `src/config/booking-origin.ts`. Copy it from `htown-atv-rentals-site` — and
>    note that `takeovers-site` is **the template every fork comes from**, so
>    porting it there improves every future location too.
> 3. **`deposit_mode = 'full'` with a $0 amount.** "Full" means charge the entire
>    tour online. A $350 buggy booking would take $350 at checkout instead of a
>    deposit. Dallas and Houston are both `per_unit $20`. This is the first thing
>    that would go wrong, and it would look like working software.
>
> Miami's connected Stripe account already exists (`acct_1U6FJqCy6l66XnLp`), but
> `charges_enabled` has **not** been confirmed — the preflight cannot read it
> without a live key, so check the Stripe Connect card on Miami's settings page,
> which renders the flag directly.
>
> Everything else follows the existing playbooks: `docs/NEW_LOCATION_RUNBOOK.md`
> for the build and the readiness gate, `docs/TRACKING_CUTOVER_PLAYBOOK.md` for
> the tracking handover.
>
> ---
>
> ### (previous state, kept for context) Dallas AND Houston are live; **Miami is next**
>
> **Houston went live 2026-08-20.** `NEXT_PUBLIC_BOOKING_ORIGIN` is set on Production,
> the marketing site carries 15 booking links and zero FareHarbor references, and all
> FareHarbor history is imported (319 active bookings, no duplicate refs). `fareharbor.com`
> is out of Houston's GA4 cross-domain list.
>
> **Before touching Miami, run the preflight** — it encodes every launch mistake made so
> far, so nobody has to remember them:
>
> ```
> npm run location:preflight -- --slug=miami
> ```
>
> It exits non-zero on a blocker. It cannot check the two things that actually killed a
> launch, so do those by hand: **load the real checkout and confirm a card form renders**,
> then **take one real booking and refund it**.
>
> Miami's known state: connected account exists (`acct_1U6FJqCy6l66XnLp`), but **0 tours,
> 0 availabilities, `deposit_mode='full'` at $0** (which means "charge the entire tour
> online"), no tracking config, no Google review counts, no retainer.
>
> ### 📋 POST-LAUNCH BACKLOG (agreed 2026-08-18, none launch-blocking)
> 1. **Email delivery tracking** — design + findings written up in
>    `docs/EMAIL_DELIVERY_TRACKING.md`. Confirmation emails are recorded NOWHERE, and
>    `sent` never becomes `delivered` for any email. No UI renders email status at all.
>    Build before the post-launch tracking deep-dive. Spans both repos.
> 2. **Refunds now DO reverse the platform fee — ⚠️ REVERSED 2026-08-21.**
>    This entry previously read "DECIDED 2026-08-18: keep the fee" and told you not to
>    touch it. That decision was reversed deliberately; `refund_application_fee: true`
>    is now set in BOTH repos (`turbobookings-dashboard/src/lib/stripe/payments.ts` and
>    the oversell path in `bookingsystem/src/app/api/webhooks/stripe/route.ts`).
>    Stripe prorates it automatically on a partial refund.
>    Two things settled it: research into how FareHarbor, Peek and Xola actually word
>    this found ours was the market outlier — FareHarbor's commission model, the one
>    matching ours, returns commission on a full refund and prorates on a partial — and
>    the term had earned **$72.00 in total across five refunds, 4% of all platform fee
>    revenue.** Not worth being the outlier over, nor worth the paragraph and worked
>    example it would have needed in every operator agreement.
>    Stripe keeps its own processing fee on a refund regardless, so the operator is
>    still out ~3%; ours on top was what made it punitive.
>    **The retainer stays non-refundable** — a subscription, not a per-booking
>    commission, and that is where FareHarbor keeps money regardless too.
>    Open: whether to refund Richard the $72 already kept (operator's money, not yet
>    authorised).
> 3. **Cockpit revenue feed** — `REPLIT_WEBHOOK_URL` unset; 17 events queued,
>    `attempt_count = 0`. Note the naming drift: dashboard reads `REPLIT_WEBHOOK_URL`,
>    bookingsystem reads `BRAIN_WEBHOOK_URL ?? REPLIT_WEBHOOK_URL`. Deferred until after
>    Dallas is live, by decision.
> 4. **Post-launch tracking & events deep dive** — full checklist in
>    `docs/POST_LAUNCH_TRACKING_DEEP_DIVE.md`. Run 12–24h after the site is live. Covers
>    Meta Events Manager (Purchase value must read $120 not $28.60, and browser+server
>    must dedupe to ONE event on `event_id`), ad-click attribution (still unproven —
>    `first_attribution_click_*` was null on the test booking), CAPI payload quality,
>    the booking.created pipe, and the email pipeline under real load.
> 5. ~~**Mobile-optimise the operator dashboard**~~ — DONE 2026-08-19. `Manifest.tsx`
>    is a card list under `md`, the header no longer clips, and the booking / recent /
>    search panels are bottom sheets on a phone. New-booking **push** notifications
>    shipped with it (push only, no email) — see `docs/PUSH_ALERTS.md`. Still open:
>    Reports and Tax report side-scroll on a phone; deferred until someone reads
>    reports on mobile.
> 6. **Stripe webhook endpoint URL** stays `book.turbobookings.net` deliberately — it is
>    Connected-accounts scoped and serves ALL markets, so a Dallas-branded URL would be
>    wrong for Houston/Miami. Do not "fix" this.
>
> **Tracking cutover for Houston / Miami: `docs/TRACKING_CUTOVER_PLAYBOOK.md`.**
> Both locations import the GA4 purchase as their PRIMARY Google Ads conversion, so
> the cutover risk is a blind bidding algorithm, not broken tracking. Read it first.
>
> ### ▶▶ NEXT SESSION STARTS HERE (updated 2026-08-18)
> **All feature work is DONE. The only thing between us and a live Dallas is the GO-LIVE cutover
> (Phase 6) — nobody has flipped the switches yet.** Everything is built + verified in Stripe TEST
> mode and pushed to `develop`. The operator runbook is **`docs/DALLAS_GO_LIVE.md`**.
>
> #### ✅ Done since 2026-08-03 (all on `develop`, pushed)
> - **Email confirmations via Resend — DONE** (was the big open item): transactional confirmation on
>   `booking.created`, plus the full lifecycle — templates + send functions, scheduler + cron,
>   enqueue points + cart-capture, one-click unsubscribe + Resend bounce/complaint webhook, and a
>   per-type **Notifications editor** in the dashboard. Resend domain verified, end-to-end tested.
> - **Dallas built out (runbook Phases 1–4 substantially done):** prod domains attached
>   (`book.`/`dashboard.turbobookings.net` resolve), Dallas branding + real catalog loaded, marketing
>   site forked with `/book` rewrite + CTAs repointed, Meta/tracking verified in Events Manager.
> - **Clerk PRODUCTION cutover — ✅ DONE 2026-08-18** (dashboard AND cockpit). Instance
>   `ins_3I4xyxb19ROb3ta3nqlOI9dF54H` on the ROOT domain `turbobookings.net`, which is what makes
>   sessions shared across `dashboard.` and `cockpit.` — verified: signing into the dashboard signs you
>   into the cockpit. Google OAuth disabled (production needs custom credentials); everyone is on email.
>   10 invitations sent with roles pre-baked, 0 errors. Cockpit moved to `cockpit.turbobookings.net`.
>   Details + traps: `docs/DALLAS_GO_LIVE.md` §6.0d.
>
>   **Not yet proven:** the session-token claim. `cockpit/auth.py` grants `owner` from EITHER the JWT
>   claim OR the `COCKPIT_OWNER_IDS` allowlist, and the owner is in the allowlist — so owner access does
>   not prove the claim works. `media_buyer` comes ONLY from the claim, so the first media buyer assigned
>   is the real test. Do not mistake that for a new bug.
>
>   **Follow-ups:** the cockpit SPA has NO sign-out UI (no `UserButton`/`SignOutButton` in `main.jsx`) —
>   sign out from the dashboard instead; the old `cockpit-production-5480.up.railway.app` still serves but
>   production Clerk will not authenticate from that origin; and do NOT delete the dev Clerk instance yet,
>   it is the rollback path.
> - **RBAC hardening:** operator role + `manage_platform` split; per-location capability resolver
>   threaded through ~84 call sites; in-platform **Team/invite** page; driver.js guided tour.
> - **Meta CAPI depth (Track B1–B3):** booking-app secret decrypt/resolveTokens; enriched CAPI
>   `user_data` + `test_event_code`; persisted `fbclid`/`gclid` + mid-funnel events for retargeting.
> - **Streamlining (partial):** fork `--assets-only` re-sync, config-driven logo path (Miami-safe),
>   automated custom-booking structural wiring, asset optimization + versioned filenames, and the
>   **New Location Runbook** SOP (`docs/NEW_LOCATION_RUNBOOK.md`).
> - **Operator T1 fixes:** "No status" label + hide processing fees, add-any-rider + recent-bookings
>   quick view, calendar new-booking picker + per-slot capacity, confirmation emails for team-made
>   bookings.
> - **Track 2 — Email-capture popup (in-house) + EMQ.**
> - **Brand/UX punch list P1–P7:** Dallas brand identity (colors + Anton font), deposit copy $50→$20,
>   fork generates brand + deposit + brand linter, bolder shared CTAs (all markets), mobile
>   widget-on-top + collapsible sections, discount codes per-item/total + valid-days, custom-field
>   multi-line operator help text. Footer Waiver link removed for Dallas.
> - **Track 3 — Monthly retainer billing (Stripe Subscription) — DONE + VERIFIED.** Flat monthly
>   retainer on the PLATFORM account (separate from the 6% per-booking fee): operator saves a card
>   (SetupIntent), admin sets amount + billing day, subscription auto-charges, dashboard Stripe
>   webhook (`/api/webhooks/stripe`) syncs `retainer_status`. Test webhook delivery confirmed **200
>   OK**. Migration **0028**. Dallas configured at $3,250/mo, day 15, status Active (test mode).
> - **Track 4 — Sales-tax-collected report — DONE** (`bfcbbef`). Reports → Sales tax: tax we collected
>   ONLINE on deposits over a date range, by tour, + CSV, + a standing operator-remits disclaimer.
>   Deliberately NOT full liability (venue-collected balances / no-shows are the operator's own books).
>   No schema change.
>
> #### 🔜 WHAT'S LEFT (do in this order)
> 1. **Dallas GO-LIVE — Phase 6 (the cutover).** Runbook `docs/DALLAS_GO_LIVE.md`. In order:
>    - **Pre-flight:** confirm the dashboard's PROD `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
>      are still **test** keys (couldn't read prod values last session — verify before flipping).
>    - Register the real **`book.dtownatvrentals.com`** subdomain (today Dallas books via
>      `book.turbobookings.net/dtown`); operator points DNS.
>    - **Flip Stripe to LIVE** in BOTH repos: `sk_live`/`pk_live` in Vercel (dashboard + bookingsystem),
>      Stripe live **Connect** onboarding for the Dallas connected account. Retainer card re-added live.
>    - **Create a LIVE-mode Stripe webhook** at `https://dashboard.turbobookings.net/api/webhooks/stripe`
>      (the test-mode endpoint does NOT carry over) → put its new `whsec_…` in `STRIPE_WEBHOOK_SECRET`
>      (Prod). The retainer webhook code is already deployed.
>    - Set prod **`ADMIN_ENCRYPTION_KEY`** on the bookingsystem project (needed for secret decrypt).
>    - Flip Dallas location `draft`→`launched`; one **real-card** booking + refund test; then public.
> 2. **Track 5 — Google (GA4 + Ads) tracking.** Earmarked for go-live; pairs with Phase 6. Not built.
> 3. **Clerk branded prod instance** (coordinated with the ads app) — cosmetic/auth polish, not blocking.
> 4. **Miami + Houston onto the custom booking system** — migrate off FareHarbor: add the `/book`
>    rewrite to each marketing site's `next.config.ts` + repoint CTAs from FareHarbor URLs; build out
>    their catalogs/config (both `launched`, no Stripe connected yet). Locked: only AFTER Dallas proves
>    the design (`bookingsystem/docs/embedding-and-tracking.md`).
> 5. **Client-onboarding automation (streamline bringing new clients on) — NOT built:**
>    - **"Generate site" button** in the dashboard that triggers a **GitHub Action** to fork+deploy a
>      new location's marketing site (today the fork is a manual `npm run fork -- <slug> --push`).
>    - **Auto-provision the Vercel project + env vars** for a new location (today done by hand per the
>      New Location Runbook). Goal: one dashboard action stands up a new client end-to-end.
>
> **Schema is at migration 0028; both repos clean on `develop` (tsc + eslint).** Detailed historical
> entries are in the log below.
> ---
>
> - **Open this repo to build:** `~/turbobookings-dashboard` — owns the schema, the catalog/config
>   surface, and the active sprint. First file to read: this one.
> - **Companion repo:** `~/bookingsystem` — the customer-facing booking engine. Sprint D committed.
>   **Customer flow COMPLETE end-to-end (Sprints G–I core)** 2026-06-28: Slice 1 (shopping +
>   tracking), Slice 1.5 (branding/calendar/detail/theme), **Slice 2+3 (`83f13d4`): single-page guest
>   checkout → Stripe Payment Element (wallets) → oversell-safe atomic commit → confirmation; webhook
>   + success-fallback both commit idempotently; server Purchase (Meta CAPI/GA4 MP) + emit
>   booking.created; full funnel events.** Needs Stripe TEST keys in the booking app env to take a
>   live test charge. See `~/bookingsystem/docs/embedding-and-tracking.md`.
> - **Customer flow VERIFIED end-to-end 2026-06-28** with a live Stripe test booking (#0001 dtown).
> - **OPERATOR BACKEND (Sprint J) COMPLETE 2026-06-28 — OB-1..OB-7, all on `develop`:** manifest +
>   check-in (per-line + bulk, mixed rollup); bookings list/detail; cancel + policy-aware refund;
>   security holds (place/capture/release on card-on-file); manual/phone booking (charge card or
>   pay-at-venue, oversell-safe); operator reschedule (+history); config editors (discount codes,
>   cancellation policies, custom fields; equipment OOS via Resources); reports + CSV export; RBAC
>   (4 roles, mutation-layer enforcement, Clerk publicMetadata.role). Commits 6aaf300→9c5dd9a.
 - **OPERATOR UX — TESTING FEEDBACK ROUNDS 1–3 COMPLETE 2026-06-29 (dashboard `develop`):**
>   - *Round 1* (`f26a460`→`ded94b9`): schedule 18-month rolling horizon (migration 0015; chunked
>     materialize) + blackout management page; Bookings grid day/week + booked-only toggles + slot
>     quick-action popover (no manifest teleport); migration 0016 (nullable PI, payment_gateway enum,
>     subtotal_cents_override) + rich New Booking form (staff note, subtotal override, discount code,
>     required acknowledgments, breakdown, payment methods Charge-card/Groupon-OTA/Walk-in × full/
>     deposit/partial). Reused by grid popover + manifest +Book.
>   - *Round 2* (`d264fa3`,`4386c5b`): **Taxes & Fees settings page** (Settings → Payments & pricing:
>     tax / processing fee / pass-vs-absorb / deposit; `updateTaxesFees`) reflecting on both booking
>     surfaces; manifest hides empty slots; card section shows on selecting Charge-card. Mock manifest
>     data seeded for dtown today (`scripts/seed-manifest-mock.ts`, `@manifestmock.test` emails).
>   - *Round 3* (`e1378a2`,`4d22380`,`941108f`,`de99d98`,`7b1ef46`): **(S1) tax charged ONLY on the
>     amount paid online** — `computeBooking()` replaces priceBreakdown/dueNowCents; fee still full-
>     subtotal card-only ($130/7%/6%, $20 deposit → fee $7.80, tax $1.40, due $29.20, balance $110).
>     **(S2) per-vehicle check-in** (migration 0017: `booking_lines.checked_in_units/no_show_units`) →
>     All/Partially/No-show/Not-yet rollup (`bookingRollup`); `LineCheckIn` = a row per vehicle.
>     **(S3) universal `BookingModal`** (click #/name on manifest → overlay: contact, per-vehicle
>     check-in, pricing, add/remove vehicles [→ balance due, capacity-checked], edit total / add
>     expense-discount, cancel/refund/holds, reschedule, send msg [queues `communication.requested`],
>     activity); online-status dropdown removed from manifest. **(S4) global top-bar booking search**
>     (`searchBookings`: #/name/email/phone → modal). **Reschedule = month calendar → time chips.**
>   - **Customer-flow tax parity DONE** (`bookingsystem` `4aa77ed`): `quote()` taxes only the online
>     deposit (per-line overrides pro-rated), matching `computeBooking`; widget label "Tax (on amount
>     paid today)". The two flows now agree.
>   - ⚠️ **Card fields on the dashboard preview need Stripe TEST keys in the Vercel PREVIEW env**
>     (`STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) — operator to add; can't be set by Claude.
>
> - **Slot "Actions & Settings" quick-action menu ✅ BUILT 2026-07-05 (dashboard `develop`)** —
>   replaced the teleport link in the Bookings-grid slot popover (`SlotPopover.tsx`) with an in-place
>   three-section menu: **(1) Availability** inline — online status auto/on/off (`setSlotStatus`) +
>   capacity override for fixed tours (`setSlotCapacity`), resource-based shows "auto · resource-limited";
>   **(2) Message customers** — compose once, channel email/SMS/both, audience all vs not-checked-in,
>   queues one `communication.requested` per booking (`messageSlotCustomers`, send still deferred to the
>   brain); **(3) Eliminate slot** — empty slots delete immediately; **booked slots are guarded** — you
>   must first group-move the bookings to another same-tour slot with room (`moveSlotBookings`: one
>   all-or-nothing txn, combined capacity check, logs `booking_reschedules` + emits `booking.rescheduled`
>   + a queued "time changed" notice each), then the now-empty slot's Delete unlocks (no auto-delete).
>   No schema change. Grid popover only. `GridSlot` gained `bookingCount`/`capacityMode`/`capacityOverride`.
>   **Verified end-to-end 2026-07-06** against the live DB (29 assertions: capacity/status persistence,
>   `gridForDate` fields, `messageSlotCustomers` all/not-checked-in/both-channel event fan-out,
>   `moveSlotBookings` all-or-nothing capacity guard + reschedule log + queued notices, `deleteSlot`
>   booked-guard + empty delete). Verification surfaced + fixed a real bug (`39f3478`): `deleteSlot`
>   now clears `booking_reschedules` rows referencing the slot (ON DELETE RESTRICT) so an **emptied
>   ex-move-source slot can actually be deleted** — the move→delete flow would otherwise FK-error.
>   Still worth a manual UI click-test on preview, but the server-action logic is proven.
>
> - **Test data cleaned 2026-07-06** — deleted the 12 `@manifestmock.test` mocks (#0002–#0013) AND
>   the real Stripe-test booking #0001 (`soselman@gmail.com`, operator-confirmed). **dtown/all
>   locations now at 0 bookings — clean slate.** (Stripe test-mode charge object remains in the Stripe
>   test dashboard; harmless.)
>
> - **Reports parity + Dashboard KPIs + mobile pass ✅ DONE 2026-07-06 (`cada89f`,`14ab374`)** —
>   Reports/Dashboard "Gross" tile summed `totalCents` (adjusted + fee + online tax), which counted
>   the processing fee + pass-through tax as revenue and hid the venue balance. Now decomposed to
>   `computeBooking` semantics via the identity **tour sales = totalCents − platformFeeCents − taxCents**:
>   Reports tiles = Bookings/Pax/Tour sales/Collected online + Balance-at-venue/Fees/Tax/Refunded;
>   by-tour adds Collected; CSV gains Sales/Discount/Fee/Tax/Refunded columns. Dashboard adds an
>   operational row (Today, Next 7 days, Balance to collect, Tax+fees 30d). Mobile: wide tables
>   (manifest, reports, landing) now horizontal-scroll; search dropdown viewport-capped. Verified
>   end-to-end (12 assertions) with the canonical example. `bookingsReport`/`listBookingsForCsv`
>   `BookingsReport`/`CsvRow` types changed (`grossCents`→`salesCents` + new money fields).
>
> - **Checkout: discount codes + custom-field collection ✅ DONE 2026-07-20 (`bookingsystem` `b498016`)** —
>   operators could configure discount codes + custom fields in the dashboard but the customer checkout
>   never surfaced them. Now wired: **(discounts, full)** ported `validateDiscountForBooking` (mirrors
>   dashboard — active/date/maxUses/item+CT restrictions, percent-bps vs fixed-cents, clamped); `quote()`
>   gained `discountCents` → discount reduces the tour subtotal and everything downstream (deposit, fee,
>   tax base, venue balance) computes off the adjusted subtotal, matching `computeBooking`; new
>   `applyDiscount()` action returns the recomputed quote, Stripe Elements amount updates live via
>   `elements.update`; `commit` persists `discount_redemptions` + bumps `usedCount` + sets
>   `bookings.discountCents`. **(custom fields, collection)** `getCheckoutFieldsForItem` returns
>   whole-booking text/checkbox/dropdown fields (excludes archived + priced quantity add-ons), checkout
>   renders + required-validates them, `commit` persists `booking_custom_field_values`. Server
>   re-validates authoritatively. Verified vs live DB (28 assertions: quote discount parity + no-discount
>   regression guard, all 8 discount branches, field fetch/filtering). tsc/lint/build clean.
>   - ⚠️ **Priced quantity add-ons deferred** (operator decision 2026-07-20): the "photographer $/each"
>     add-on pricing needs its own design pass (how it interacts with the deposit split / tax). Fields of
>     kind `quantity` are hidden at checkout until then. **NEXT sub-item when resumed.**
>   - ⚠️ **Full Stripe-charge path (discount+fields → PI metadata → webhook commit → persisted rows)
>     still needs Stripe TEST keys on the `bookingsystem` preview to take a live test booking.** The unit
>     logic is proven; the end-to-end charge is not yet exercised post-change.
>
> - **Checkout: seat-hold countdown ✅ DONE 2026-07-21 (`bookingsystem` `c56ad50`; schema `ae85721`)** —
>   note: the pre-existing `booking_holds` table is Stripe **security-deposit** holds, NOT seat inventory,
>   and there was no seat-reservation table. Added a **new `seat_holds` table** (dashboard migration
>   `0018`, applied to the shared Neon DB; mirrored into `bookingsystem` schema): a short-lived reservation
>   of N units on an availability keyed by an opaque `hold_token`. `listOpenSlots` now treats active
>   (non-expired) holds as consumed inventory (booked + held), so a shopper mid-checkout doesn't leave the
>   last seat visible to everyone. `reserveSeats`/`releaseSeats` actions (capacity-checked, excludes the
>   shopper's own token); checkout reserves on mount (token in `sessionStorage`), shows a live mm:ss
>   countdown (amber < 60s) and on expiry blocks Pay + offers a reselect link; token flows into PI
>   metadata and `commit` releases the hold in-txn. `commit` remains the authoritative oversell guard —
>   holds are a UX/urgency + race reducer. TTL = 10 min (default). Verified vs live DB (13 assertions).
>   tsc/lint/build clean. **TTL + banner copy to be refined against the FareHarbor customer widget.**
>   - ✅ **Grounding DONE 2026-07-21:** live crawl of the FareHarbor **customer** widget (htown 1-hr ATV)
>     via chrome-devtools → `bookingsystem/docs/fareharbor-customer-flow-crawl.md` (+ screenshots in
>     `turbobookings-dashboard/.fh-crawl/`, gitignored). Confirms our deposit-split + tax-on-online-amount
>     already matches FareHarbor; surfaces parity gaps (see below). Backend crawl:
>     `~/takeovers-site/docs/booking-system-fareharbor-inventory.md`.
>
> - **Google reviews badge + FareHarbor-parity quick wins ✅ DONE 2026-07-22
>   (`bookingsystem` `152a47d`; dashboard `a008eb3`, migration 0019)** — no live Places API exists, so
>   reviews are **operator-configured location fields** (`google_rating_tenths`/`review_count`/
>   `reviews_url`) set in the dashboard (Settings → Reviews) and rendered customer-side by a `ReviewBadge`
>   on the tour page (replaced the placeholder) + checkout header (hidden until set). Quick wins from the
>   crawl also shipped: **"N left!" slot scarcity** (all slots, amber+"!" when ≤5), **phone required** at
>   checkout, amount-due copy (**"Total"** line + **"Pay later (at venue)"**), and a **marketing opt-in**
>   checkbox → `commit` sets `customers.marketing_email_consent_at` (only upgrades). dtown seeded 4.9/5135
>   for testing. Verified (8 assertions on the reviews action). tsc/lint/build clean.
>   - ⚠️ Live Places API auto-refresh of the rating is a future add (needs an API key + per-location
>     place_id); today the operator sets the number by hand.
>
> - **Tour copy: Markdown editor + per-tour content lists ✅ DONE 2026-07-22
>   (dashboard `dce8701`, migration 0020; `bookingsystem` `524948b`)** — replaced the hardcoded,
>   identical-for-every-tour `TOUR_PLACEHOLDER` with real per-tour fields. Migration 0020 adds
>   `items.highlights`/`included`/`what_to_bring` (jsonb string[]). Dashboard tour form: **`MarkdownField`**
>   (Details editor with a Bold/Italic/Heading/Bullet/Link toolbar that inserts Markdown + a live preview
>   using the same react-markdown pipeline the customer page uses) and **`StringListField`** (repeatable
>   line editor for the three lists → hidden JSON input, parsed server-side, same pattern as
>   `PricingMatrixEditor`). Customer tour page renders `descriptionMd` as "Details" (bold/headings/bullets)
>   + the three lists as checkmark bullets (hidden when empty). dtown 1-Hour ATV seeded with real content.
>   Verified in-browser (customer render); dashboard editor click-test needs Clerk sign-in.
>
> - **Per-tour photos ✅ BUILT 2026-07-22 (dashboard `f3b9785`; `bookingsystem` `47a9e48`)** — the upload
>   path is done; only real photo *assets* from the operator remain. Dashboard tour edit page has an
>   **`ItemPhotoManager`** (upload to Vercel Blob → `items.photoUrls`, Make-cover = move to `photoUrls[0]`,
>   remove; manage_config-gated, JPEG/PNG/WebP ≤5 MB, ≤8). Customer tour page renders a **`TourGallery`**
>   (cover hero + thumbnail strip, click to swap), falling back to the location gallery then the branded
>   gradient. Verified end-to-end against live Blob + DB (9 assertions) + in-browser (hero + thumb strip
>   render, no layout break). Blob host already allowed in both `next.config` image `remotePatterns`.
>   ⚠️ **Operator action:** upload real per-tour photos via the tour edit page.
>
> - **FareHarbor-parity content sections ✅ DONE 2026-07-22 (dashboard `0a2e383`, migration 0021;
>   `bookingsystem` `d9dd9e9`)** — added Overview key-values, FAQs, and per-tour Cancellations prose.
>   Migration 0021 adds `items.min_age`/`languages`/`group_size_label`/`faqs`(jsonb {q,a}[])/
>   `cancellation_notes_md`. Dashboard tour form: Overview inputs + a `FaqEditor` (repeatable Q/A → hidden
>   JSON) + a Cancellation-notes `MarkdownField`. Customer tour page renders an Overview block
>   (Duration always; Age/Offered-in/Group-size when set), an FAQ list, and cancellation markdown — each
>   hidden when empty. dtown seeded; verified in-browser. tsc/lint/build clean.
>
> - **RBAC — server enforcement + UI hiding ✅ DONE 2026-07-22 (dashboard `493776b` + `097989e`)** —
>   the "cosmetic polish" turned up a real gap: only 8 of 22 action files checked permissions, so ~14
>   config mutations were **server-unenforced**. **(1) Closed all gaps** — `denyIfCannot`/`assertCan` now
>   guard every mutating action (manage_config for config, checkin for check-in). **(2) UI hiding** —
>   `getCapabilities()` → `LocationShell` nav filter + `CapabilitiesProvider`/`useCaps`; route-tree guards
>   (`requirePageCapability` in catalog layout + thin guard layouts for settings/tracking/integrations/
>   setup/activity = manage_config, dashboard/bookings/reports = manage_bookings); config-root redirects
>   lower roles to their landing; BookingModal + Manifest gate controls by cap (check-in always visible).
>   Verified against the real code path with an injected Clerk role (23 assertions). tsc/lint/build clean.
>   ⚠️ **Per-role visual check needs the operator to set a Clerk user's `publicMetadata.role`.**
>
> - **▶ NEXT (start here):**
>   1. **Live Dallas build + operator-onboarding SOPs**, then migrate Miami/Houston once Dallas proves it.
>   - **Deferred to a later phase (operator decision 2026-07-22): priced quantity add-ons** — not until
>     after the booking system launches. Needs the add-on/per-person-fee pricing design (the crawl's
>     "Park Admission Fee $20/person" is a per-person venue fee in the same design space).
>   - **Verification boundary:** the reviews badge + quick wins are logic-verified + build-clean but not yet
>     eyeballed in a running customer flow (needs the bookingsystem dev server or preview). The full Stripe
>     charge path (discount/custom-fields/hold-release/marketing-consent → committed rows) still wants a
>     live test booking on the preview.
>   - **Deferred (do not build yet):** the slot mass-message *send* itself (UI queues now, needs brain
>     send to actually deliver); priced custom-field add-ons (above); customer
>     profile / Returning badge / cross-booking history / "new booking for contact".
>
> **Why the dashboard catalog/config is built BEFORE the customer flow (locked — do not re-litigate):**
> the customer flow only *reads* tours, pricing, and bookable time slots. Its gating input is
> **availability** — concrete date/time slots — which is produced by the dashboard's schedule builder
> (Sprint C → D). Until the dashboard can generate availability, there is nothing for a customer to
> book or for us to test the flow against.
>
> **Terminology map** (legacy "Phase" vs. live "Sprint" — reconciled here so they stop competing):
> - *Phase 0* = schema + scaffold + cross-system tracking — **done in both repos**.
> - *Dashboard catalog/config* = **Sprints A–F** (this repo).
> - *"Phase 1 booking flow"* = the customer engine = **Sprints G–I** (`bookingsystem` repo).
> - *Operational dashboard* (manifest / refund / reschedule) = **Sprint J**.
> - `~/.claude/plans/snazzy-jingling-squirrel.md` is the dashboard-WIDE plan; THIS doc is the
>   booking-system-specific live roadmap.

> **Provenance:** This roadmap was reconstructed after a terminal crash lost the
> working session. The Sprint A–D naming is recovered from real breadcrumbs in the
> code (commit messages + the `schedule` stub + the `CatalogSubNav` comment).
> Sprint E onward is **inferred** from the schema (`src/lib/db/schema.ts`, 28
> tables) and the Phase-1 plan (`~/.claude/plans/snazzy-jingling-squirrel.md`).
> Treat A–D as confirmed scope and E+ as a best-effort plan, not gospel.

## What "this portion" means

The custom booking system = a FareHarbor replacement, spanning two repos:

- **`turbobookings-dashboard`** (this repo) — the **operator-facing config + management**
  surface. The `Catalog` tab is where an operator defines tours, resources,
  customer types, schedules, pricing.
- **`bookingsystem`** — the **customer-facing booking engine** that consumes that
  config (availability, cart, checkout, payment). Currently at Phase 0 (scaffold +
  cross-system tracking only).

The schema for the WHOLE system already lives in this repo's `schema.ts`. The
sprints below are about building the **UI + logic** on top of tables that mostly
already exist.

---

## CATALOG CONFIG (dashboard repo) — operator setup surface

### Sprint A — Customer Types + Resources ✅ DONE (committed `ec0d8c7`)
- Customer Types CRUD (Single Rider, Double Rider, …) — `customer_types`
- Resources CRUD (capacity pools: ATVs, UTVs) — `resources`
- Catalog tab shell + sub-nav + schedule/dashboard placeholders

### Sprint B — Tours ✅ DONE (committed 2026-05-30)
- Tours list with pricing summary — `items` (commit `4cc7533`, part 1)
- Create / edit a tour — `ItemForm`, `tours/new`, `tours/[id]`
- Pricing matrix (price, tax override, visibility, min/max qty per customer
  type) — `item_customer_types`, `PricingMatrixEditor` (part 1)
- **Resource Requirements** matrix — `resource_requirements` (part 2). Per
  (tour × customer type) × resource grid of quantity consumed; diff-based save
  (insert/update/delete); reachable from the tours list, edit, and pricing
  pages. Route: `tours/[id]/resources`. Files: `ResourceRequirementsEditor.tsx`,
  `getItemResourceMatrix` (data), `saveItemResourceRequirements` (action).

This completes the `CatalogSubNav` "Tours → items + item_customer_types +
resource_requirements" mapping. Build + tsc + eslint all clean.

**Deferred to V1.5 (noted, not built):** per-item cancellation policy override
(`items.cancellation_policy_id` column exists, no UI); item photo upload
(`items.photo_urls` — Blob, lands with the asset library).

### Sprint C — Schedule, part 1: recurring availability ✅ BUILT 2026-06-27
- `availability_schedules` (RRULE-driven). Weekly recurring patterns per tour:
  weekday toggles, start time, duration, capacity per slot, online-booking
  status, season window, materialize horizon.
- Schedule builder UI replaced the `schedule` placeholder (`catalog/schedule`
  list/new/[id]) with a live "next 5 slots" preview.
- Added `rrule` dep + `src/lib/rrule/weekly.ts` (compile/parse/preview — naive
  recurrence; time stored separately in `starts_at_time_local`). Added
  `locations.timezone` column (migration `0009`) + seeded per-location tz +
  dtown test catalog (2 customer types, 2 tours).
- Files: `lib/rrule/weekly.ts`, `lib/data/schedules.ts`, `lib/actions/schedules.ts`,
  `components/ScheduleForm.tsx`, `app/locations/[slug]/catalog/schedule/{page,new,[id]}`.
- **Refinement (2026-06-27, operator feedback):**
  - **Multiple start times per schedule** — `starts_at_time_local` (single)
    replaced by `start_times_local jsonb` array. Schedule form has an interval
    generator ("every N min from X to Y") + manual add/remove chips; preview
    interleaves date × time. (Migrations `0010` add+backfill, `0011` drop old col.)
  - **Per-tour capacity mode** — new `items.capacity_mode` enum
    (`resource_based` default | `fixed`), set on the tour form. Resolves the
    capacityPerSlot-vs-resources conflict: `capacity_per_slot` is now nullable and
    used ONLY for fixed tours; resource-based tours derive capacity from resource
    pools (the schedule form shows "limited by ATVs (30)…" instead of a number).
    Backfill set existing tours with resource requirements → `resource_based`,
    others → `fixed`.
- Verified: tsc + lint + build clean; live-DB round-trip (multi-time + null/fixed
  capacity). **Pending: UI click-test (needs Clerk sign-in) + commit.**

**Deferred to Sprint D:** local→UTC slot generation using `locations.timezone` +
`start_times_local`; the capacity math (resource-based: per required pool
`floor((max − outOfService − consumed)/quantityConsumed)` honoring the
customer-type mix; fixed: `capacity_per_slot − booked`); per-slot overrides;
blackout dates; calendar view; nightly materialize cron.

### Sprint D-1 — Slot generation engine + view ✅ BUILT 2026-06-27
- `availabilities` bulk-generated from schedules: RRULE × `start_times_local` ×
  `locations.timezone` → UTC slots, DST-correct via `luxon`. Engine in
  `src/lib/availability/generate.ts` (`expandScheduleToSlots`,
  `materializeScheduleRow` insert-missing+prune via unique `(schedule_id,
  starts_at)` index [migration `0012`], `materializeAllActiveSchedules`).
- Generation runs on schedule create/update/pause/delete (hooked into
  `actions/schedules.ts`) and nightly via `api/cron/materialize-availability`
  (vercel.json `0 8 * * *`, CRON_SECRET-guarded).
- Slot view: `catalog/schedule/slots` (date-grouped, tz-formatted) + data in
  `lib/data/availability.ts`. Added `luxon` dep.
- Verified: tsc/lint/build clean; live-DB test (July CDT→15:00Z, Nov CST→16:00Z;
  idempotent re-run; prune-on-time-removal). **Pending: UI click-test + commit.**

### Sprint D-2 — Per-slot overrides + blackouts + calendar ✅ BUILT 2026-06-27
- **Blackout dates**: `blackout_dates` table (migration `0013`; per-location,
  optional per-tour, day or range). The generator skips blacked-out days every
  run, so blackouts persist across regeneration; adding/removing one re-runs
  `materializeLocationActiveSchedules`. `data/blackouts.ts` + `actions/blackouts.ts`.
- **Per-slot overrides**: on/off/auto status for any slot, capacity override for
  fixed-capacity tours, manual slot delete (booking-safe). `actions/availability.ts`
  + `components/SlotControls.tsx`.
- **Booking-safe regeneration**: prune/clear now excludes slots referenced by
  `bookings` (`notInArray(... bookedSlotIds())`) — verified with a real booking.
- **Calendar**: `catalog/schedule/calendar` month grid (slot counts + blackout
  markers) → click a day for slot controls + a blackout toggle
  (`components/BlackoutToggle.tsx`). Data: `slotCountsForMonth`, `listSlotsForDay`.
- Verified: tsc/lint/build clean; live-DB test (blackout prunes unbooked slots,
  preserves booked). **Pending: UI click-test + commit.**

### Sprint E — Custom Fields *(inferred; schema exists, no UI)*
- `custom_fields` (per-location pool — V1 kinds: text, checkbox, dropdown,
  quantity) + `item_custom_fields` (attach to a tour at customer-type or
  whole-booking level). Covers add-ons (photographer $/each), age
  acknowledgments, special requests. Waivers = external Smartwaiver link per the
  schema note.

### Sprint F — Cancellation policies UI *(inferred)*
- `cancellation_policies` + `cancellation_policy_rules` were **seeded** in Phase 0
  (commit `e536ddb`) but have **no editing surface** yet. Build the editor and
  wire each tour to a policy. (Could fold into Settings rather than Catalog.)

---

## BOOKING ENGINE (bookingsystem repo) — customer-facing + transactional

> Currently only scaffolded (Phase 0). All of the below is unbuilt UI/logic on top
> of existing tables. Order is inferred from a normal booking funnel.

### Sprint G — Availability display + cart/hold
- **Slice 1 ✅ BUILT 2026-06-28 (`1e7a4c7`)** — branded shopping: tour list → detail →
  date/time picker (real slots, tz-correct, capacity-aware) → rider quantities → live
  deposit/fee/tax price → continue; tenant pixel/GA4 tags + funnel events; schema
  re-synced; Replit→Railway retarget; `docs/embedding-and-tracking.md`.
- **Slice 2 (next)** — seat hold (`booking_holds` + TTL), customer info form + custom
  fields, oversell-safe commit (neon pooled driver / optimistic check).
- Public availability query honors capacity consumed by bookings + open holds (the
  precise shared-pool/atomic path lands with the commit step).

### Sprint H — Checkout + booking creation
- `customers`, `bookings`, `booking_lines` (per customer-type line),
  `booking_custom_field_values`.
- Deposit calculation (flat / percent / per-rider — see `locations` deposit
  config), `discount_codes` + `discount_redemptions`.

### Sprint I — Payments (Stripe Connect)
- Stripe Connect onboarding is already scaffolded (Phase 0, commit `bad3dd6`).
- Deposit charge at booking, `payment_methods_on_file`, platform fee (default
  6%), balance capture. `payments` table.

### Sprint J — Post-booking lifecycle
- Confirmation + cross-system event emit (`outbound_event_queue` — Phase 0 done).
- Reschedule (`booking_reschedules`) + cancel with policy enforcement.
- Operator-side booking management in the dashboard (manual add, reschedule,
  refund) — the operator counterpart to the customer flow.

---

## Immediate next action — START HERE NEXT SESSION

**Sprints A–J are done and all three locations are live on the system.** This section used to point at
Sprint D (June); the build has been feature-complete for two months and the sprint list below is now
history, not a plan. The state blocks at the TOP of this file are the live pick-up point.

### Open work, in priority order

0. **⚠️ BACK UP THE RAILWAY `/data` VOLUME. It has none.** Single most valuable thing on this list per
   hour spent. That volume is the ONLY copy of:
   * `bookings.db` — the revenue ledger the entire 10–16% spend objective is measured against
   * `journal/proposals.json` + `actions.json` — every decision the cockpit has made, its baseline and
     after ROAS, and the win/loss playbook the analyst reads before each analysis
   * `inventory.db` — capacity history, accumulating from 2026-08-28
   A volume failure loses all of it permanently, and the decision history is exactly the asset that
   makes the cockpit improve over months. Nothing else here compounds like it. A periodic export to
   somewhere durable (Blob, S3, even a committed snapshot) is a small job.
   > **Evidence, 2026-08-29 ~01:12-02:00 UTC:** Railway ran a US-West **storage** partial outage
   > ("problems starting up, slow or unavailable storage") plus a deploy-worker backlog. The cockpit
   > sat at `0/1 replicas` for ~50 min and `railway redeploy` did NOT clear it — during a platform
   > incident a redeploy just re-queues behind the same backlog, so the correct action was to wait.
   > Nothing was lost: `booking.created` rides the retry queue (`queue_on_failure` defaults true) and
   > inventory snapshots are `queue_on_failure: false` by design, replaced by the next hourly tick.
   > This was an AVAILABILITY event, not a data-loss one - but it is the exact failure shape this
   > item exists for, and it landed on the storage layer holding the only copy.
1. **⛔ STEP 7 — the analyst prompt block. THE NEXT BUILD ACTION.** `cockpit/analyst.py::_SYSTEM`.
   Steps 1-6 of the inventory feed are live but INERT: the model has never been told inventory exists.
   Held deliberately until the feed had a clean 24h — from 2026-08-29 ~02:00 UTC it has that (minus one
   snapshot lost to the Railway outage; the gap is the incident, not a bug). Must state, in this order:
   physical capacity ≠ media headroom · **veto only** (may block or downgrade a scale, never justify one
   and never justify a cut) · an empty near-term slot is the NORMAL state, not weak demand · a tour-day
   shortage may never become a serving-day bid change. Deploy with `railway up`, not git.
2. **⛔ Decide `booking_timing_heatmap` — in the same pass as step 7.** Computed in `cockpit/bookings.py`,
   embedded in every fact pack as `pack["fareharbor"]["booking_timing_heatmap"]` (~168 numbers), read by
   nothing. **Recommendation: drop it from the pack, keep the function**, with a comment saying it
   belongs to serving-day work if that is ever built. Wiring it is defensible too. Doing nothing is not:
   a second never-read fact beside the new inventory block teaches the model the pack is decorative.
3. **Four tours whose low-stock ceiling is at or below the default 5** need their threshold tuned or
   the message fires on empty slots: dtown Night Glow, htown Buggy, both miami UTV tours.
4. ~~**Miami's 4 UTVs are all marked out of service.**~~ **Largely resolved 2026-08-29** — 3 of 4 were
   repaired overnight and the feed observed it unprompted. Re-check the remaining 1.
5. **Dallas ran 24 ATVs against 22 serviceable on 2026-08-22.** Either `out_of_service_count` is stale
   or the day genuinely oversold. Operational, not code — but the near-term half divides by serviceable,
   so a stale count biases every near-term reading in that market.
6. **FareHarbor reminder emails for the 22 imported bookings** — imported bookings do not enter the
   normal reminder path.
7. **Emit `discount_code` on `booking.created`.** Specified in the event contract §4, never emitted.
   Without it the cockpit can recommend a midweek offer and have no way to tell whether it worked —
   which is the whole point of the offer layer. One field, same shape as the attribution fields.
8. **`bookingsystem` dependabot residue** — the dashboard and the sites are clean after the Next 16.3.3
   upgrade; the booking repo still has open advisories.

### Completed 2026-08-28/29 — do not re-open

* **FareHarbor imports could not be rescheduled.** Two MONEY bugs, not a UI gap: `rescheduleBooking`
  rebuilt `totalCents` from the catalog (repricing a legacy FareHarbor total) and `syncPlatformFee`
  charged our 6% on an imported booking we never sold. An earlier agent blamed an empty slot picker;
  that was wrong — every tour had hundreds of pickable slots. **Verify against live data before
  accepting a root cause.**
* **Final FareHarbor import, all three locations** — 22 bookings. `npm run import:fh --
  --file=<path> --slug=<dtown|htown|miami>`; dry run by default, `--commit` to write, one CSV per
  location. **Re-importing an overlapping export is safe** — the planner reports already-imported
  rows rather than duplicating them. **Never let imported bookings reach the cockpit.**
* **Reschedule missing for one rep** — `CapabilitiesProvider` wrapped only `{children}`, not
  `LocationShell`, so the toolbar rendered with no capabilities. Misdiagnosed twice as a role problem
  before the owner pointed out the rep already had manager access on other bookings.
* **Next.js 16.3.3 across five repos** — 4 high-severity advisories → 0 in this repo and the sites.
* **Preview database restored** (~96 days stale) and the dependabot advisories cleared.
* **Attribution project #25** — two bases (first + last click), `ttclid`/TikTok in the data model
  before launch, `tb_aid` finally issued (was 0 of 1,446).
* **Inventory feed steps 1-6** — see the state block at the top of this file. **Step 7 is NOT done.**

### Parked, decided but not built

- **Cross-location roll-up.** Design settled: aggregate over each location's OWN local day, scope with
  `accessibleLocationIds()`. Deferred by the owner in favour of higher-value booking features.

### Will not be corrected

~11 bookings whose totals were damaged by the old `syncPlatformFee` overwrite. The originals cannot be
reconstructed; the bug is fixed and the reconciliation checker is clean going forward.

