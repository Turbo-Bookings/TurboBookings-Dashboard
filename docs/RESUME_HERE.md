# Resume here

Paste the prompt below into a new session. It is deliberately short — it points at the docs rather than
restating them, because a prompt that duplicates the docs goes stale the moment the docs move.

---

## The prompt

```
Read docs/BOOKING_SYSTEM_SPRINTS.md (the ⭐ RESUME HERE block at the top, and the
"Open work, in priority order" list near the bottom) before doing anything.

We are mid-phase on the inventory feed to the ad cockpit. Steps 1-6 are live but
INERT — the analyst has never been told inventory exists. Step 7, the analyst
prompt block, is the next build action, and item 2 (booking_timing_heatmap) is
an open decision to settle in the same pass.

This is cockpit work: also read ~/ads/SHARED/AGENTS.md and
docs/cross-system/BOOKING_TO_COCKPIT_FEED.md. The cockpit deploys with
`railway up`, NOT git.

Before writing anything, confirm the feed is still healthy
(curl -s https://cockpit.turbobookings.net/api/health) and tell me the current
state and your proposed next action. Wait for me to confirm before you build.
```

`CLAUDE.md` auto-loads `AGENTS.md` and `PLATFORM_ARCHITECTURE.md`, so the architecture arrives on its
own. Once the inventory phase is closed, drop the middle two paragraphs and the prompt goes back to
the short generic form: *"Read the ⭐ RESUME HERE block, tell me the state and the next action, wait."*

---

## ▶ Where things stand — 2026-08-29 (CURRENT; the two sections further down are history)

**The whole platform is live and healthy.** All three markets on our own booking system, cockpit
steering spend, revenue + attribution + capacity all feeding it.

Verified in-browser 2026-08-29 02:10 UTC:

| Market | Efficiency 7D | ROAS 30D | Spend 7D | True revenue 7D | Review cards |
|---|---|---|---|---|---|
| Miami | 16.1% | 4.3x | $10,848 | $67,547 | 4 |
| Dallas | 5.5% | 6.4x | $4,195 | $76,944 | 1 |
| Houston | 16.2% | 4.9x | $16,261 | $100,386 | 11 |

Miami and Houston sit at the TOP of the 10-16% efficiency band; Dallas has headroom but the cockpit is
correctly refusing to scale it into creative fatigue. Dallas still has no Google Ads account — the UI
shows `Google — no account`, which is right, not a bug.

### The one thing in flight

**Inventory feed, step 7 of 7.** Steps 1-6 (compute → emit → store → summarise → fact pack →
`efficiency()` capacity key → freshness → stale alert) are live. **Nothing reaches the model yet** —
that is step 7, `cockpit/analyst.py::_SYSTEM`, deliberately held until the feed had run a clean 24h.
It now has. Alongside it, settle `booking_timing_heatmap` (item 2 in the open-work list).

### Two operational facts from the 2026-08-29 Railway incident

1. **`railway status` lies during a platform incident.** It reported `Building` / `0/1 replicas` while
   the app served perfectly. **`/api/health` is the truthful signal**, not the CLI.
2. **`railway redeploy` does NOT clear a wedged rollout during a Railway incident** — it re-queues
   behind the same backlog. Check <https://status.railway.com> FIRST; if there is an active incident in
   US West (our region is `sfo`), wait rather than redeploy.

Blast radius that night was zero, by design: `booking.created` rides the retry queue
(`queue_on_failure` defaults true) while inventory snapshots set it `false` and are replaced by the
next hourly tick. One snapshot (02:00 UTC) was lost — that gap is the incident, not a bug.

**If the session is about the ad cockpit**, add:

```
This is cockpit work — read ~/ads/SHARED/PLATFORM_ARCHITECTURE.md and
turbobookings-dashboard/docs/cross-system/BOOKING_TO_COCKPIT_FEED.md first.
```

---

## Where things stand (2026-08-22) — HISTORY

All three locations run on our own booking system; FareHarbor is retired as a booking surface. The
cockpit revenue feed is connected and verified — this was the last missing piece of the ad loop.

| Doc | What it is |
|---|---|
| `docs/BOOKING_SYSTEM_SPRINTS.md` | **The pick-up point.** Build status, what's open, exact next action |
| `PLATFORM_ARCHITECTURE.md` | Face / Brains / Memory topology. Lives in 7 repos — see below |
| `docs/cross-system/BOOKING_TO_COCKPIT_FEED.md` | The revenue feed: endpoint, HMAC, mapping, traps |
| `docs/cross-system/CROSS_SYSTEM_EVENT_CONTRACT.md` | Envelope + transport. **§4's catalog is partly aspirational** — read its reality-check block |
| `AGENTS.md` | Ownership, git workflow, cross-repo split |

## Doc map — which file is canonical for what

| Topic | Canonical file | Synced to |
|---|---|---|
| Platform topology (Face / Brains / Memory) | `PLATFORM_ARCHITECTURE.md` | all 7 repos |
| **Tracking, pixels, attribution, click IDs** | **`docs/TRACKING.md`** | **all 7 repos** |
| Booking-system build status & roadmap | `docs/BOOKING_SYSTEM_SPRINTS.md` | dashboard only |
| Launching a new location | `docs/NEW_LOCATION_RUNBOOK.md` | dashboard only |

Both synced files are maintained HERE and pushed out with `npm run docs:sync -- --write`.
`npm run docs:check` exits 1 if any copy has drifted. Never edit the shared half in another repo —
it is overwritten.

`docs/TRACKING.md` carries a numbered **fix log** (TRK-01…). When you fix a tracking defect, close its
row with the commit and a line on how you proved it — that is the whole point of the file.

## Repo map — what to edit where

| Repo | Owns | Deploys via |
|---|---|---|
| `turbobookings-dashboard` | Storefront DB schema, catalog, ops dashboard, **the event queue + retry cron** | Vercel, git push |
| `bookingsystem` | Customer booking flow, checkout, click-ID capture | Vercel, git push |
| `~/ads/SHARED` (cockpit) | Ads, creative intelligence, the revenue ledger, ROAS | **`railway up` — NOT git** |
| `takeovers-site` + forks | Marketing sites | Vercel, git push |
| `~/takeovers-platform` | AI voice/SMS receptionist — **retiring prototype** | Replit |

## Six things that cost real time — don't re-derive them

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
6. **When the cockpit 502s, check <https://status.railway.com> BEFORE touching anything.** On
   2026-08-29 it was down ~50 min on a Railway US-West storage incident, not our code. `railway status`
   reported `Building` / `0/1 replicas` while the app was serving fine — trust `/api/health`, not the
   CLI. And `railway redeploy` does not clear a wedge during an incident; it re-queues behind the same
   backlog.

## Editing PLATFORM_ARCHITECTURE.md

It lives in **seven** repos. Everything from `## The decision (read this first)` down is shared and
must stay byte-identical; above it is each repo's own role header.

```bash
cd ~/turbobookings-dashboard
# edit the shared half here, then:
npm run docs:sync            # dry run
npm run docs:sync -- --write
npm run docs:check          # exits 1 on drift
```

Then commit each repo separately. Hand-maintaining the copies failed — by 2026-08-21 they carried
three different status dates and disagreed about whether the booking system was live.

## Where things stand (2026-08-26) — HISTORY

Booking system **v1.5**. All three locations live. Everything below is on `main` and in production.

### v1.5 — since the five-phase pass

| Change | Where |
|---|---|
| **Per-tour "Only N left!" threshold** — the booking site printed the count on EVERY slot ("65 left" under an empty Houston slot). Now silent above the threshold. | migration **0039**, both repos |
| **Dallas Glow: 60 → 45 min, Fri/Sat/Sun only.** 7 existing bookings honoured at their hour and closed to new sales; manifest flags them. | `scripts/retime-glow-slots.ts` |
| **`syncPlatformFee` stopped overwriting booking totals** — it recomputed `total` from `subtotal`, erasing FareHarbor tax and custom-price overrides. Had already fired on 16 bookings. | `src/lib/booking/platformFee.ts` |
| **Six more cross-tenant server actions guarded**, incl. `getTeamForLocation` (every staff email at any location). `openSlotsForItem` moved out of the actions layer. | `src/lib/actions/*` |
| **`assignRole` privilege gap** — an operator could demote a peer operator out of their own permissions. | `src/lib/actions/team.ts` |
| **Sales-by-user now uses the same revenue identity** as every other report, and excludes imports. | `src/lib/data/reports.ts` |
| Check-in / cash / no-show reports default to the last 7 days, and "never marked" no longer counts tours that have not run. | `src/app/locations/[slug]/reports/*` |

### v1.4 — roles, dashboard, bookings, reports

| Phase | What changed |
| --- | --- |
| 1 · Access | `view_revenue` (director+) and `collect_payment` (basic_user+). Bookings + dashboard open to `checkin`; reports behind `view_revenue`. **Four unguarded server actions and three unguarded CSV routes closed.** |
| 2 · Dashboard | Today at the venue → Sales today → Next 7 → Last 7. "pax" is now "vehicles", because that is what the number always was. |
| 3 · Bookings | Per-tour vehicle totals, a date picker, a rolling-7 view, history that names who acted. |
| 4 · Reports | A registry — one entry plus one folder per report. Eight reports. |
| 5 · Follow-ups | No-show call list, win-back report, append-only follow-up log, reschedule history that survives slot cleanup. |

**Migrations 0037–0039 are hand-written and applied directly.** The drizzle journal is still drifted —
**do not run `db:generate`**.

> ⚠️ **Changing a schedule's duration does NOT retime existing slots.** `materializeScheduleRow`
> matches rows by `startsAt` alone and inserts with `onConflictDoNothing`; nothing in the codebase ever
> updates `endsAt`. Dallas Glow's change looked applied and every slot was still 60 minutes. Any future
> duration change needs an explicit retime — `scripts/retime-glow-slots.ts` is the pattern, and it
> never touches booked slots, slots with live holds, or the past.

> ⚠️ **Booked slots survive a schedule change but stay SELLABLE.** Pruning removes empty slots on
> dropped days automatically; booked ones are kept by design, and no read path checks whether a slot
> still matches its schedule. They must be closed explicitly or the tour quietly keeps running on days
> the operator dropped.

> ⚠️ **`bookingsystem/src/lib/db/schema.ts` is a hand-maintained COPY** and its item queries use bare
> `select()`, so a column missing there is **silently dropped** — no error, just a feature that does
> nothing. Mirror any new `items`/`locations` column in the same pass.

> ⚠️ **The reschedule write path RESETS check-in state** after snapshotting it onto the reschedule
> row. That is what stops a won-back customer arriving pre-flagged as a no-show. The snapshot must land
> first, in the same transaction.

> ⚠️ **Win-backs are only identifiable from 2026-08-25.** The 133 historical reschedule rows carry zero
> check-in counts; "0 won back" for August is a gap in the record, not a business fact.

Run `npx tsx scripts/check-report-routes.ts` after touching the report registry.

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
