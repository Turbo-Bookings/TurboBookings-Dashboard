# Cross-System Documentation

This folder is a **snapshot** of the cross-system contract that defines how
Vercel-side surfaces (this dashboard, the booking system, the per-location
marketing sites) communicate with the Replit-side backend (AI voice/SMS
agents + marketing automation engine).

## What lives here

- **`CROSS_SYSTEM_EVENT_CONTRACT.md`** — the canonical event schema for the
  one-way Vercel → Replit event stream. Read this before touching any
  webhook emit, signature, or envelope code.

## Where the full doc set lives

The canonical companion docs are kept outside any single repo so they can
evolve without coupling to a release cycle:

| Doc | Purpose | Owner |
|---|---|---|
| `LIVING_ARCHITECTURE.md` | Current state of the platform across the three surfaces. Replaces the older `takeovers_platform_architecture.md`. | Cross-team |
| `CROSS_SYSTEM_EVENT_CONTRACT.md` | This file — the wire format Vercel ↔ Replit. | Cross-team |
| `VERCEL_PREP_FOR_REPLIT_INTEGRATION.md` | Vercel-side implementation guide. | Selmen |
| `REPLIT_PHASE_0_CUSTOMER_FOUNDATION.md` | Replit-side implementation guide. | Replit lead |

Ask Selmen for the canonical copies if you need them.

## Update protocol

When the canonical `CROSS_SYSTEM_EVENT_CONTRACT.md` changes:

1. Update the canonical copy first.
2. Manually copy the new version into `docs/cross-system/` on **both**
   `TurboBookings-Dashboard` and `Bookingsystem` repos.
3. Open one PR per repo so the in-repo readers (and reviewers) see the
   change at the same time the implementing code lands.

Tech debt: when the schema gets extracted into a shared private package,
this folder gets replaced with a one-line pointer to that package's docs.
