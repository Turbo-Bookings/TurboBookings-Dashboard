# Custom Booking System — Sprint Roadmap (reconstructed 2026-05-30)

> ## ⭐ SINGLE SOURCE OF TRUTH — RESUME HERE
> This file is the canonical build-status + sequencing roadmap for the custom booking system across
> **BOTH** repos. If anything elsewhere disagrees on build **ORDER**, this file wins.
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
> - **▶ NEXT (start here) — remaining conversion work:**
>   1. **Tour copy = operator-authored per-item content** (not hardcoded) — add a per-tour rich content
>      field in the dashboard (items); the operator's existing FareHarbor Details/Additional-info/Highlights
>      text lifts directly. Replaces `TOUR_PLACEHOLDER`. **No external input needed — buildable now.**
>   2. **Photos** — real per-tour photos. Plumbing exists; **blocked on the operator supplying photo
>      assets.**
>   3. **Priced quantity add-ons stay LAST** (needs the add-on/per-person-fee pricing design — the crawl's
>      "Park Admission Fee $20/person" is a per-person venue fee in the same design space).
>   4. **RBAC UI hiding (polish)** — hide actions the current role can't perform (mutation layer already
>      enforces; this is cosmetic so lower roles don't see dead buttons).
>   5. **Live Dallas build + operator-onboarding SOPs**, then migrate Miami/Houston once Dallas proves it.
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
**Sprint D is complete** (D-1 generation + D-2 overrides/blackouts/calendar), all
committed on `develop`. The dashboard now fully manages the catalog + availability.
Remaining + next:
1. Click-test the Calendar (`/locations/dtown/catalog/schedule/calendar`, Clerk
   sign-in): month grid counts; click a day → toggle a slot off / set capacity /
   delete; black out a day → its slots clear and stay gone after a schedule
   re-save; un-blackout → slots return. Set `CRON_SECRET` in Vercel for the
   `materialize-availability` cron.
2. **Next major step: the customer-facing booking flow** in the `bookingsystem`
   repo (Sprints G–I): availability display → cart/hold → checkout → Stripe.
   It's now unblocked — real, timezone-correct `availabilities` exist to sell.
