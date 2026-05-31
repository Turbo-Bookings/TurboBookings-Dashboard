# Custom Booking System — Sprint Roadmap (reconstructed 2026-05-30)

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

### Sprint C — Schedule, part 1: recurring availability
- `availability_schedules` (RRULE-driven). Weekly recurring patterns per tour:
  days, start times, capacity per slot, season start/end, min lead time.
- Schedule builder UI replacing the `schedule` placeholder.

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
Sprint B is done and committed on `develop`. **Next up: Sprint C — recurring
availability schedules (`availability_schedules`, RRULE-driven).** Replace the
`schedule` placeholder with a schedule builder (days, start times, capacity per
slot, season window, min lead time). Mirror the established Catalog patterns:
`data/<x>.ts` + `actions/<x>.ts` (validate → audit → revalidate) + a client
editor component + pages under `catalog/schedule/`. Then Sprint D generates
concrete `availabilities` slots from those schedules.

Optional warm-up before Sprint C: smoke-test Sprint B against the dev DB (create
a tour, set pricing, set resource requirements) — it's only been build-verified,
not click-tested with live data.
