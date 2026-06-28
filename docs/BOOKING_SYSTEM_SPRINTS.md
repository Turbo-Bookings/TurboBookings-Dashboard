# Custom Booking System — Sprint Roadmap (reconstructed 2026-05-30)

> ## ⭐ SINGLE SOURCE OF TRUTH — RESUME HERE
> This file is the canonical build-status + sequencing roadmap for the custom booking system across
> **BOTH** repos. If anything elsewhere disagrees on build **ORDER**, this file wins.
>
> - **Open this repo to build:** `~/turbobookings-dashboard` — owns the schema, the catalog/config
>   surface, and the active sprint. First file to read: this one.
> - **Companion repo:** `~/bookingsystem` — the customer-facing booking engine (Phase 0 scaffold only).
> - **Status:** Sprints A–B done + committed. Sprint C **built 2026-06-27** (build + DB-path
>   verified; UI click-test + commit pending). **▶ NEXT after C is committed: Sprint D — generate
>   concrete slots from schedules.**
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

### Sprint D — Schedule, part 2: generated slots + overrides
- `availabilities` — bulk-generate concrete date+time slots from schedules.
- One-off overrides: per-slot `online_booking_status` (on/off/auto), capacity
  override, blackout dates, manual extra slots.
- Calendar view of generated availability.

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
- Public availability query (read `availabilities` honoring capacity already
  consumed by bookings + open holds).
- `booking_holds` — temporary seat hold while customer checks out (TTL).

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
Sprint C is **built** (schedule builder + RRULE helpers + tz column) and verified
by build + a live-DB data-path test, but **not yet click-tested in the browser or
committed**. Two things remain:
1. Click-test the schedule builder at `/locations/dtown/catalog/schedule` (needs
   Clerk sign-in): create / edit / delete a schedule, confirm the live preview and
   the round-trip of weekdays + season. Then commit Sprint C to `develop`.
2. **Sprint D — generate concrete `availabilities` slots** from schedules:
   expand the RRULE × `starts_at_time_local` × `locations.timezone` → UTC slots,
   per-slot overrides, blackout dates, calendar view, nightly materialize cron.
   The `rrule` helpers (`lib/rrule/weekly.ts`) and the tz column are already in
   place for this.
