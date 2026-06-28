# Platform Architecture & Build Topology (canonical)

> Drop-in orientation so any work session understands how the Turbo Bookings systems fit together
> without re-deriving it. Canonical spec: `~/Documents/Turbo Booking Saas/Detailed Dev Docs/LIVING_ARCHITECTURE.md`.
> Last updated 2026-06-05.

## This repo's role
**Admin / ops portal and schema owner of the Storefront Neon DB** (locations, bookings, customers,
payments; Drizzle schema lives here). Vercel / Next.js. Hosts the event-retry cron. Part of the **FACE**.

## ⚠️ CURRENT STATUS & THE INTEGRATE PHASE (updated 2026-06-06)
- The **cockpit** (ad-management + creative-intelligence = the "Python ad service") is **DEPLOYED + LIVE**
  on Railway as a STANDALONE app (its own UI + Python API) at
  `https://cockpit-production-5480.up.railway.app`, behind Clerk (shared SSO), creative-director access granted.
- **INTEGRATE PHASE (planned, NOT done yet):** that cockpit UI will **fold INTO this single unified Vercel
  dashboard as the "ads / creative" module**, and the Railway side becomes **API-ONLY** (the brain this
  dashboard calls). 🚫 **DO NOT rebuild the ad/creative tooling when building this dashboard** — design the
  dashboard to HOST that module / call the Railway Python ad service's API. The logic already exists and is
  proven; rebuilding = double work. (Cockpit code: `~/ads/SHARED/cockpit/`.)

## The decision (read this first)
- The **Replit project (`takeovers-platform`)** — Retell (AI phone agent), Aircall (human reps + SMS),
  the SMS agent — **stays as-is and serves as the PROTOTYPE.** Do NOT re-architect it in place.
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
- Each service has its OWN `DATABASE_URL`. The brains (Node platform + Python ad service) share the
  Intelligence DB. The cockpit computes **true first-party ROAS** from bookings/touchpoints copied INTO
  that DB — not by querying the storefront DB directly.

## Decision-making by domain
- Customer / email / SMS / AI-agent decisions → **Node platform service** (Intelligence DB).
- Ad / creative / budget decisions → **Python ad service** (Intelligence DB).
- Cross-domain decisions happen in the Node platform, reading the unified record.

## Auth & tenancy
- One **Clerk** login (orgs = locations/agencies; roles = operator / VA / creative / client).
- One unified dashboard; what each person sees is scoped by role + tenant.

## Status (updated 2026-06-27)
- **Live:** marketing sites + the **FareHarbor-era** booking flow on them, the dashboard shell, the
  Replit AI prototype.
- **In active build (NOT live):** the **custom booking system** — `bookingsystem` repo (customer
  engine) + `turbobookings-dashboard` catalog/config. This is the FareHarbor replacement and spans
  two repos. **Canonical roadmap + exact next action:
  `turbobookings-dashboard/docs/BOOKING_SYSTEM_SPRINTS.md`** (Sprints A–B done; **Sprint C next**).
- **Building (in order):** cockpit → Railway (Clerk, creative-only) ▸ Phase 0 touchpoints/attribution ▸
  multi-tenant Node platform on Railway.
