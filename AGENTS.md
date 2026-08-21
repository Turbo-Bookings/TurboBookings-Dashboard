<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# What this project is

**TurboBookings Dashboard** — a multi-tenant client portal that sits above the per-location ATV-tour marketing sites. Lives at `dashboard.turbobookings.net`. Long-term monetization: monthly subscription + add-ons (SEO, email marketing, AI chatbot, voice receptionist).

**Who owns what** (this has been misread before — the two kinds of location are not the same business relationship):

| Location | Relationship | What that means |
| --- | --- | --- |
| **Miami** (`miami`) | Selmen is a **minority owner** of the LLC | Partly our own business. More latitude on pricing and terms; the 6% is partly paying ourselves. Its marketing site (`~/takeovers-site`) is also the template every fork comes from. |
| **Dallas** (`dtown`), **Houston** (`htown`) | **Operator clients** — owned by the operator (Richard), not by us | Third parties. Commercial terms have to be documented and disclosed, not assumed. We cannot reach into their Stripe, Radar or bank settings; anything there needs the owner to do it. |

3–5 more planned in 12 months, and those will be **operator clients** like Dallas and Houston — so per-operator friction (Radar config, Stripe onboarding, agreement language) is the thing that scales badly, not per-location catalog work.

The approved plan lives at `~/.claude/plans/snazzy-jingling-squirrel.md` — read it before any non-trivial changes.

**Booking-system build status & sprint roadmap:** `docs/BOOKING_SYSTEM_SPRINTS.md`
is the live pick-up point — what sprint we're on, what's done, and the exact next
action. Read it first when resuming the custom booking system (Catalog tab +
the `bookingsystem` repo). Current: Sprints A–B done; **next is Sprint C
(recurring availability schedules)**.

## Companion repos

- `~/takeovers-site` — Miami marketing site, the template every fork comes from
- `~/htown-atv-rentals-site` — Houston, first fork of the template
- `~/takeovers-platform` — local clone of Replit's `Takeovers-Phone-and-SMS-Agent` repo (AI receptionist, the "operations brain" side of the system; long-term unified-platform host). See `~/takeovers-site/docs/unified-platform-integration.md` for the cross-repo contract.

## Cross-repo responsibility split

- **This dashboard (Vercel)** owns: client-facing portal, intake forms, asset library, tracking config (Edge Config bridge), external-setup tracking, cross-location analytics, operator-defined SMS/email flows
- **Replit** owns: AI / voice receptionist, predictive marketing, multi-touch attribution, gclid/fbclid ad attribution, AI-driven reactive SMS sends

If you're touching tracking-config, marketing-flow config, intake forms, or cross-location analytics — this is the right repo.
If you're touching anything AI / voice / predictive / multi-touch — wrong repo (that's Replit).

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

# Stack (planned, not yet wired)

- **Neon Postgres** + **Drizzle ORM** — provision via Vercel Marketplace
- **Clerk** — auth, orgs = locations, roles = operator | va | client
- **Vercel Blob** — asset storage (logos, hero videos, gallery photos, OG images)
- **Vercel Edge Config** — per-location runtime config bridge (tracking IDs, feature flags) written by this app
- **`node-vibrant`** — logo color palette extraction
- **shadcn/ui** — component library on top of Tailwind
- **Stripe** — Phase 2 (subscription billing)
