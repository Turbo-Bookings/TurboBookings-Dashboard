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

## Where things stand (2026-08-26)

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
