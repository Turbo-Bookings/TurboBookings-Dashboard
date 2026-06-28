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
> - **▶ NEXT (fast-follows): per-tour photo upload (dashboard, reuse MediaForm); pre-payment seat
>   hold + countdown; operator bookings manifest; then the conversion-optimization pass (real reviews,
>   copy, A/B). Migrate Miami/Houston onto the system once Dallas proves it.**
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
