# Resume here

Paste the prompt below into a new session. It is deliberately short — it points at the docs rather than
restating them, because a prompt that duplicates the docs goes stale the moment the docs move.

---

## The prompt

```
Read docs/BOOKING_SYSTEM_SPRINTS.md (the ⭐ RESUME HERE block at the top) and
PLATFORM_ARCHITECTURE.md before doing anything. Then tell me the current state
and what you think the next action is, and wait for me to confirm before you
build.
```

That's it. `CLAUDE.md` already auto-loads `AGENTS.md` and `PLATFORM_ARCHITECTURE.md`, so the
architecture arrives on its own.

**If the session is about the ad cockpit**, add:

```
This is cockpit work — read ~/ads/SHARED/PLATFORM_ARCHITECTURE.md and
turbobookings-dashboard/docs/cross-system/BOOKING_TO_COCKPIT_FEED.md first.
```

---

## Where things stand (2026-08-22)

All three locations run on our own booking system; FareHarbor is retired as a booking surface. The
cockpit revenue feed is connected and verified — this was the last missing piece of the ad loop.

| Doc | What it is |
|---|---|
| `docs/BOOKING_SYSTEM_SPRINTS.md` | **The pick-up point.** Build status, what's open, exact next action |
| `PLATFORM_ARCHITECTURE.md` | Face / Brains / Memory topology. Lives in 7 repos — see below |
| `docs/cross-system/BOOKING_TO_COCKPIT_FEED.md` | The revenue feed: endpoint, HMAC, mapping, traps |
| `docs/cross-system/CROSS_SYSTEM_EVENT_CONTRACT.md` | Envelope + transport. **§4's catalog is partly aspirational** — read its reality-check block |
| `AGENTS.md` | Ownership, git workflow, cross-repo split |

## Repo map — what to edit where

| Repo | Owns | Deploys via |
|---|---|---|
| `turbobookings-dashboard` | Storefront DB schema, catalog, ops dashboard, **the event queue + retry cron** | Vercel, git push |
| `bookingsystem` | Customer booking flow, checkout, click-ID capture | Vercel, git push |
| `~/ads/SHARED` (cockpit) | Ads, creative intelligence, the revenue ledger, ROAS | **`railway up` — NOT git** |
| `takeovers-site` + forks | Marketing sites | Vercel, git push |
| `~/takeovers-platform` | AI voice/SMS receptionist — **retiring prototype** | Replit |

## Five things that cost real time — don't re-derive them

1. **The cockpit does not deploy from GitHub.** `railway status --json` → `source: None`. Pushing to
   `main` deploys nothing. `cd ~/ads/SHARED && railway up --detach --yes`.
2. **Saving a Vercel env var does nothing to a running deployment.** Redeploy after — and target the
   *newest* deployment or you roll production back. `vercel deploy --prod` from a clean checkout is
   unambiguous.
3. **There is no Intelligence Neon DB.** The cockpit has no Postgres client; revenue is one SQLite
   table on the Railway volume. Docs that say otherwise are corrected, but the belief is sticky.
4. **`REPLIT_WEBHOOK_*` is a fossil** — nothing is ever sent *from* Replit. It's the key our storefront
   *signs with*. `BRAIN_WEBHOOK_*` are the real names now.
5. **`vercel env pull` returns sensitive values as empty strings.** Any script needing a real secret
   must run inside Vercel, not on a dev machine. This has bitten twice.

## Editing PLATFORM_ARCHITECTURE.md

It lives in **seven** repos. Everything from `## The decision (read this first)` down is shared and
must stay byte-identical; above it is each repo's own role header.

```bash
cd ~/turbobookings-dashboard
# edit the shared half here, then:
npm run arch:sync            # dry run
npm run arch:sync -- --write
```

Then commit each repo separately. Hand-maintaining the copies failed — by 2026-08-21 they carried
three different status dates and disagreed about whether the booking system was live.

## Where things stand (2026-08-25)

Booking system **v1.4**. All three locations live. A five-phase pass across roles, the dashboard,
the bookings page and reports landed today — all of it on `main` and in production.

| Phase | What changed |
| --- | --- |
| 1 · Access | `view_revenue` (director+) and `collect_payment` (basic_user+). Bookings + dashboard open to `checkin`; reports behind `view_revenue`. **Four unguarded server actions and three unguarded CSV routes closed** — any signed-in user could read any location's customer list by passing a different slug. |
| 2 · Dashboard | Today at the venue → Sales today → Next 7 → Last 7. The 30-day and outstanding bands are gone. "pax" is now "vehicles" everywhere, because that is what the number always was. |
| 3 · Bookings | Per-tour vehicle totals, a date picker, a rolling-7 view, and history that names who acted. |
| 4 · Reports | A registry — one entry plus one folder per report. Revenue, check-in, cash-to-collect, sales-by-user, tax, uncollected fees. |
| 5 · Follow-ups | No-show call list and win-back report, an append-only follow-up log, and reschedule history that survives slot cleanup. |

**Migrations 0037 and 0038** are hand-written and applied directly (the drizzle journal is still
drifted — do not run `db:generate`). `payments.kind` distinguishes a desk card payment from the
checkout deposit; `booking_followups` and the `booking_reschedules` snapshot columns are new.

> ⚠️ **The reschedule write path now RESETS check-in state** after snapshotting it onto the
> reschedule row. That is what stops a won-back customer arriving on their new date still flagged as
> a no-show. The snapshot must land first, in the same transaction — reversing that order destroys
> the only evidence a win-back happened.

> ⚠️ **Win-backs are only identifiable from 2026-08-25.** The 133 historical reschedule rows were
> backfilled with times and tour names but carry zero check-in counts, because nothing recorded them
> before. The report says so on its face; do not read "0 won back" for August as a business fact.

Run `npx tsx scripts/check-report-routes.ts` after touching the registry — a `csv: true` with no
export route renders a download button that 404s, which shipped twice before it was caught.

### Platform fee — three routes, no chasing

Every booking fee now has a way home: taken at checkout, taken at the desk when the venue runs the
card through *Collect balance*, or billed onto the operator's platform invoice. FareHarbor imports and
Groupon/OTA are exempt by rule and never appear as work.

**Link stays at checkout** — decided 2026-08-24. See the ✅ block in `docs/BOOKING_SYSTEM_SPRINTS.md`
before anyone proposes removing it again.

### 🗓 Parked — cross-location roll-up

Every figure is scoped to one location; the root page shows no numbers. Parked deliberately in favour
of booking-system features. The design decisions are already made — see the 🗓 block in
`docs/BOOKING_SYSTEM_SPRINTS.md` before re-deriving any of it.

## Next phase — Stage 3, the real Phase 0

Intelligence DB on Neon, `touchpoints`, identity resolution, and resolving the click ids we now collect
into **per-campaign** attribution (cockpit project #25, unblocked as of today).

Also on that path: `customers.anonymous_id` is **0 of 727** because the marketing sites never issue the
`tb_aid` cookie the contract assumes. Anonymous→identified stitching is dead until that producer exists.

> ⚠️ **"Phase 0" means two different things** in this doc set. In the Detailed Dev Docs it is the
> brains-side touchpoint build (**not started**). In `BOOKING_SYSTEM_SPRINTS.md` it is the storefront
> scaffold (**done**). `PLATFORM_ARCHITECTURE.md` always means the former.
