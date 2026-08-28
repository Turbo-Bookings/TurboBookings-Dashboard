# Platform Architecture & Build Topology (canonical)

> **This file lives in SEVEN repos.** Everything from `## The decision (read this first)` down is
> SHARED and must stay byte-identical; everything above it is that repo's own `## This repo's role`
> header. `turbobookings-dashboard` holds the canonical copy — edit the shared half there, then sync:
>
> ```bash
> npm run arch:sync            # from turbobookings-dashboard
> ```
>
> Drop-in orientation so any work session understands how the Turbo Bookings systems fit together
> without re-deriving it. Canonical spec: `~/Documents/Turbo Booking Saas/Detailed Dev Docs/LIVING_ARCHITECTURE.md`.
> Last updated 2026-06-05.

## This repo's role
**Admin / ops portal and schema owner of the Storefront Neon DB** (locations, bookings, customers,
payments; Drizzle schema lives here). Vercel / Next.js. Hosts the event-retry cron. Part of the **FACE**.

## ⚠️ CURRENT STATUS & THE INTEGRATE PHASE (updated 2026-06-06)
- The **cockpit** (ad-management + creative-intelligence = the "Python ad service") is **DEPLOYED + LIVE**
  on Railway as a STANDALONE app (its own UI + Python API) at
  `https://cockpit.turbobookings.net` (the old `cockpit-production-5480.up.railway.app` still serves but production Clerk will not authenticate from that origin), behind Clerk (shared SSO), creative-director access granted.
- **INTEGRATE PHASE (planned, NOT done yet):** that cockpit UI will **fold INTO this single unified Vercel
  dashboard as the "ads / creative" module**, and the Railway side becomes **API-ONLY** (the brain this
  dashboard calls). 🚫 **DO NOT rebuild the ad/creative tooling when building this dashboard** — design the
  dashboard to HOST that module / call the Railway Python ad service's API. The logic already exists and is
  proven; rebuilding = double work. (Cockpit code: `~/ads/SHARED/cockpit/`.)

## The decision (read this first)
- **There are TWO Replit projects, not one.** `takeovers-platform` (cloned at `~/takeovers-platform`)
  serves **Miami only** — its Aircall number, business identity and pickup address are hardcoded, and
  it has no tenant column. **Dallas and Houston run on a SECOND, separate Replit project with its own
  GitHub repo**, which is NOT cloned locally and is not the one in `~/takeovers-platform`.
  > ⚠️ Do not conclude from reading `~/takeovers-platform` that Dallas and Houston have no phone/SMS
  > system. They do. That inference was made and was wrong (2026-08-28). Anything measured against the
  > local clone describes **Miami only**.
  >
  > **Open:** the second project's GitHub repo is currently not visible in the account and may need
  > re-pushing from Replit before it can be read, planned against, or migrated.
- Both Replit projects — Retell (AI phone agent), Aircall (human reps + SMS), the SMS agent —
  **stay as-is and serve as the PROTOTYPE.** Do NOT re-architect them in place.
- The **production, multi-tenant version is being built on Railway.** Railway becomes the always-on
  "brains"; Replit retires once the Railway build reaches parity.
- The ad-management / creative-intelligence tool (the "cockpit", Python, in `ads/SHARED`) deploys to
  **Railway as the Python ad service** (behind Clerk; creative-only access for the creative director first).

## Topology — Face / Brains / Memory
```
FACE    → VERCEL  : all web — marketing sites, booking app, dashboard, cockpit UI (ONE Clerk login)
BRAINS  → RAILWAY : always-on backends —
                      • Node platform service  (customers, AI agents, email/SMS)  ← rebuild of the Replit app
                      • Python ad service      (ads, creative intelligence)        ← the cockpit
MEMORY  → NEON    : Postgres. TWO databases joined by a one-way event pipe (NOT one shared DB):
                      • Storefront DB   (Vercel-side): locations, bookings, customers, payments
                      • Intelligence DB (brains-side): touchpoints, unified customers, conversations,
                        campaigns, ad performance, fatigue, winners, reports
```

## How they communicate
- The storefront (Vercel) **emits** one-way, HMAC-signed events (`booking.created`, `payment.succeeded`,
  `page.viewed`, `ad.click_landed`, …) → the brains write them into the Intelligence DB (`touchpoints` +
  the unified customer record). Brains **never write back** to the storefront DB. (Queue + retry already
  exists: `outbound_event_queue` + cron — hosted in THIS repo.)
- Each service has its OWN `DATABASE_URL`. The brains (Node platform + Python ad service) are INTENDED
  to share the Intelligence DB.

> ⚠️ **The Intelligence DB does not exist yet (verified 2026-08-21).** An earlier version of this file
> claimed the cockpit computes true first-party ROAS from bookings/touchpoints in a shared Neon DB. It
> does not. `grep DATABASE_URL|psycopg|sqlalchemy` across the cockpit returns **zero hits**: revenue
> lives in **one SQLite table on the Railway volume** (`cockpit/bookings.py`), fed today by
> `POST /api/webhooks/turbobookings` from our storefront. Per-campaign attribution is cockpit project
> **#25** and is not built. Do not plan against the Neon path until Phase 0 lands.
> See **`docs/cross-system/BOOKING_TO_COCKPIT_FEED.md`**.

## Decision-making by domain
- Customer / email / SMS / AI-agent decisions → **Node platform service** (Intelligence DB).
- Ad / creative / budget decisions → **Python ad service** (Intelligence DB).
- Cross-domain decisions happen in the Node platform, reading the unified record.

## Auth & tenancy
- One **Clerk** login (orgs = locations/agencies; roles = operator / VA / creative / client).
- One unified dashboard; what each person sees is scoped by role + tenant.

## Status (updated 2026-08-21)
- **Live:** all three locations on the **custom booking system** — Dallas, Houston and Miami have each
  cut over and FareHarbor is retired as a booking surface. Marketing sites, dashboard, cockpit
  (`cockpit.turbobookings.net`, Clerk production), Replit AI prototype.
- **Just shipped:** the booking → cockpit revenue feed, replacing the dead FareHarbor webhook. Click ids
  now ride on `booking.created`, which unblocks cockpit project #25 (per-platform true ROAS).
- **Next:** Phase 0 touchpoints/attribution (the Intelligence DB — never started) ▸ multi-tenant Node
  platform on Railway ▸ INTEGRATE PHASE (cockpit UI folds into this dashboard).
- **Roadmap:** `turbobookings-dashboard/docs/BOOKING_SYSTEM_SPRINTS.md`.

> ⚠️ **"Phase 0" means two different things** across this doc set. In the Detailed Dev Docs it is the
> brains-side touchpoint/identity build (**not started**). In `BOOKING_SYSTEM_SPRINTS.md` it is the
> storefront schema/scaffold/emit plumbing (**done**). This file always means the former.

> ⚠️ **The cockpit does NOT deploy from GitHub** (`source: None`). Deploy with
> `cd ~/ads/SHARED && railway up --detach --yes`. Pushing to `main` deploys nothing.
