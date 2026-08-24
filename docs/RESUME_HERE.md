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

## Where things stand (2026-08-24)

Booking system **v1.3**. All three locations live; cockpit revenue feed connected. This session
hardened the operator tooling — rep payments, customer edits, cancel/refund, shared resource pools,
cross-tour reschedule, uncollected fees. Full table in the ⭐ block of `docs/BOOKING_SYSTEM_SPRINTS.md`.

> ⚠️ **The drizzle migration journal is out of sync with production.** `0033`–`0035` are hand-written
> and applied directly; `npm run db:generate` will try to re-create tables that already exist. Write
> new migrations by hand with `IF NOT EXISTS` until someone reconciles it.

## Next phase — Stage 3, the real Phase 0

Intelligence DB on Neon, `touchpoints`, identity resolution, and resolving the click ids we now collect
into **per-campaign** attribution (cockpit project #25, unblocked as of today).

Also on that path: `customers.anonymous_id` is **0 of 727** because the marketing sites never issue the
`tb_aid` cookie the contract assumes. Anonymous→identified stitching is dead until that producer exists.

> ⚠️ **"Phase 0" means two different things** in this doc set. In the Detailed Dev Docs it is the
> brains-side touchpoint build (**not started**). In `BOOKING_SYSTEM_SPRINTS.md` it is the storefront
> scaffold (**done**). `PLATFORM_ARCHITECTURE.md` always means the former.
