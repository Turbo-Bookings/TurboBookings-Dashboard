<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# What this project is

**TurboBookings Dashboard** — a multi-tenant client portal that sits above the per-location ATV-tour marketing sites. Lives at `dashboard.turbobookings.net`. Long-term monetization: monthly subscription + add-ons (SEO, email marketing, AI chatbot, voice receptionist).

**Who owns what** (this has been misread before — the two kinds of location are not the same business relationship):

| Location | Relationship | What that means |
| --- | --- | --- |
| **Miami** (`miami`) | Selmen is a **minority owner** of the LLC | Partly our own business. More latitude on pricing and terms; the 6% is partly paying ourselves. Its marketing site (`~/takeovers-site`) is also the template every fork comes from. |
| **Dallas** (`dtown`), **Houston** (`htown`) | **Operator clients** — owned by the operator (Richard), not by us | Third parties. Commercial terms have to be documented and disclosed, not assumed. We cannot reach into their Stripe, Radar or bank settings; anything there needs the owner to do it. |

3–5 more planned in 12 months, and those will be **operator clients** like Dallas and Houston — so per-operator friction (Radar config, Stripe onboarding, agreement language) is the thing that scales badly, not per-location catalog work.

**Starting a session?** `docs/RESUME_HERE.md` has the prompt to use and a map of which doc is which.

**Editing `PLATFORM_ARCHITECTURE.md`?** It lives in SEVEN repos; the half below `## The decision` is
shared. Edit it here, then `npm run docs:sync -- --write`, then commit each repo.
`npm run docs:check` exits 1 if any copy has drifted.

> ⚠️ The old `sync-architecture.mjs` matched its anchor with an unanchored `indexOf`, which
> found the backticked mention of the anchor in the banner instead of the real heading. On
> 2026-08-27 it wrote the DASHBOARD's role header into all six other repos. Repaired
> 2026-09-04; the replacement matches whole lines and has a `--check` mode. Do not reintroduce
> substring anchoring.

**Touching tracking, pixels, attribution or click IDs?** `docs/TRACKING.md` is the canonical
record — how a click becomes an attributed booking, the per-market state, the measurement traps, and
a numbered fix log (TRK-01…) that records when each known defect was closed and how it was proven.
It is synced into all seven repos. **Read it before measuring anything**: two of its traps
(click-ID capture began 2026-08-28; the booking cutover was 2026-08-21) invalidate most naive
date windows.

**Booking-system build status & sprint roadmap:** `docs/BOOKING_SYSTEM_SPRINTS.md`
is the live pick-up point — what sprint we're on, what's done, and the exact next
action. Read it first when resuming the custom booking system (Catalog tab +
the `bookingsystem` repo). Current: Sprints A–B done; **next is Sprint C
(recurring availability schedules)**.

## Companion repos

- `~/takeovers-site` — Miami marketing site, the template every fork comes from
- `~/htown-atv-rentals-site` — Houston, first fork of the template
- `~/takeovers-platform` — local clone of Replit's `Takeovers-Phone-and-SMS-Agent` repo (AI receptionist, the "operations brain" side of the system; long-term unified-platform host). See `~/takeovers-site/docs/unified-platform-integration.md` for the cross-repo contract.
  > ⚠️ **This clone is MIAMI ONLY** — hardcoded Aircall number, business identity and pickup address,
  > no tenant column. **Dallas and Houston run on a SECOND Replit project with its own GitHub repo,
  > not cloned here.** Reading only the local clone and concluding those markets have no phone/SMS
  > system is wrong — that mistake was made on 2026-08-28. Any measurement taken from
  > `~/takeovers-platform` describes Miami and nothing else.
  > **Open:** that second repo is not currently visible in the GitHub account and may need re-pushing
  > from Replit before it can be read or migrated.

## Cross-repo responsibility split

- **This dashboard (Vercel)** owns: client-facing portal, catalog + bookings, intake forms, asset library, tracking config, cross-location analytics, the Storefront DB schema, and the outbound event queue + retry cron
- **`bookingsystem` (Vercel)** owns: the customer-facing booking flow, checkout, and click-ID capture at checkout
- **Ad cockpit — `~/ads/SHARED` (Railway, Python)** owns: ad + creative intelligence, the revenue ledger, and per-platform ROAS
- **Replit (TWO projects — `~/takeovers-platform` is Miami only; Dallas + Houston have their own)** own: the AI voice/SMS receptionist — **and are retiring PROTOTYPES**. Their production replacement is the Node platform service on Railway, not yet built

If you're touching tracking-config, catalog, bookings, intake forms, or cross-location analytics — this is the right repo.
If you're touching ads, creative, or ROAS — that's the cockpit (`~/ads/SHARED`), not here.
If you're touching AI voice/SMS — that's Replit, and prefer minimal keep-it-running fixes.

> ⚠️ Corrected 2026-08-21. This section used to assign "multi-touch attribution, gclid/fbclid ad
> attribution" to Replit. That was never true and is now actively wrong: click IDs are captured by
> `bookingsystem` at checkout, stored on `customers`, and shipped to the **cockpit** on
> `booking.created`. See `docs/cross-system/BOOKING_TO_COCKPIT_FEED.md`.

# Git workflow

**Default working branch is `develop`. Never commit directly to `main`.**

- Before making any code changes, run `git checkout develop` if you aren't already on it.
- Push commits to `origin/develop` — Vercel deploys a preview from this branch.
- Test the change on the preview URL before promoting.
- Promotion to production happens by merging `develop` → `main`. Don't do this without explicit user confirmation.

Vercel will be configured so `main` is the production branch (live at `dashboard.turbobookings.net`) and `develop` deploys as a preview.

# Stack (what's wired so far)

- **Next.js 16.2.4** App Router (matches takeovers-site for consistency)
- **React 19.2.4**
- **TypeScript** + **Tailwind CSS v4**
- **ESLint 9**

# Stack (shipped)

- **Neon Postgres** + **Drizzle ORM** — the Storefront DB; schema owned by this repo
- **Clerk** — auth on the production instance, roles via `publicMetadata`; capability gates in `lib/auth/roles.ts`
- **Vercel Blob** — asset storage (logos, hero videos, gallery photos, OG images)
- **Stripe Connect** — Standard, direct charges with `application_fee_amount`
- **`node-vibrant`** — logo color palette extraction
- **shadcn/ui** — component library on top of Tailwind
- **Stripe** — Phase 2 (subscription billing)
