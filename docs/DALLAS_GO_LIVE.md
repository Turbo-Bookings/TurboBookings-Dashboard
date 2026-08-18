# Dallas Go-Live Runbook (operator SOP)

> Staged **soft launch**: stand up the real branded site in **Stripe test mode**, verify end-to-end,
> then flip to live payments. Dallas is the **first market on the custom booking system** (Miami/Houston
> stay on FareHarbor until Dallas proves the design). Reusable template for future location launches.
> Interactive version: rendered as an Artifact ("Dallas Go-Live"). Owner tags: 🧑 YOU · 🤖 ME · 👥 BOTH.

## Current state (assessed 2026-07-23)
- **Dallas = `dtown`**, status `draft` (nothing public). Domain `dtownatvrentals.com` — operator owns it, DNS ready.
- Pricing/policy set: 7% tax · $20 per-unit deposit · 6% processing fee · cancellation policy attached.
- Catalog: 2 **placeholder** tours + 1 schedule → **replace with the real Dallas lineup**. 0 bookings (clean).
- All keys **test** (Stripe `pk_test`/`sk_test`, Clerk `pk_test`). Test-mode Stripe Connect account linked.
- **Not built yet:** the Dallas marketing site; custom prod domains for the apps
  (`book.turbobookings.net` / `dashboard.turbobookings.net` don't resolve — apps live on Vercel `*.vercel.app`).
- Vercel projects: `bookingsystem`, `turbo-bookings-dashboard` (team `team_wQB4dt6pRt1pYpASK446WLG4`).
- Shared **Storefront** Neon DB (dashboard ↔ booking app). Brain = Railway (optional; events queue if unwired).

## Phase 1 — Production domains + env 🧑
1. Attach `book.turbobookings.net` → `bookingsystem` project (the URL the marketing site rewrites to).
2. Attach `dashboard.turbobookings.net` → `turbo-bookings-dashboard` project.
3. Booking-app prod env: `DATABASE_URL` (prod Neon), Stripe **test** keys, `TURBOBOOKINGS_TENANT_ID`
   (generate once via `uuidgen`), optional `BRAIN_WEBHOOK_URL`/`BRAIN_WEBHOOK_SECRET`.
4. Dashboard prod env: shared `DATABASE_URL`, Clerk test keys, `BLOB_READ_WRITE_TOKEN`, Stripe test keys,
   `CRON_SECRET` (nightly `materialize-availability` cron).
5. Redeploy; confirm both domains serve HTTPS. DB already migrated (latest `0021`) — nothing to run. 👥

## Phase 2 — Dallas brand & settings 🧑 (dashboard UI)
- Branding: display name, support email, phone, address (currently blank; legal name `DTown ATV Rentals LLC` set).
- Visual identity: primary/accent colors + logo upload (auto-extracts a palette).
- Settings → Reviews: Google rating/count/link (social-proof badge).
- Settings → Tracking: Meta Pixel / GA4 / Google Ads IDs (funnel works without; add before ad spend).
- Integrations: confirm **test** Stripe Connect onboarding is complete so test charges succeed.
- Confirm taxes & fees + cancellation policy read correctly.

## Phase 3 — Real Dallas catalog 🧑→🤖
1. Operator sends real tours: name, duration, rider types & prices, capacity (shared pool vs fixed),
   weekly schedule (days + start times).
2. 🤖 enter tours/pricing/schedules; materialize slots.
3. 👥 write content (Details markdown, Highlights/Included/What-to-bring, Overview, FAQs, Cancellation notes).
4. 🧑 upload real per-tour photos (tour edit → Photos; first = cover/hero).
5. 🤖 remove placeholder tours + leftover test data.

## Phase 4 — Dallas marketing site 🤖 + 🧑 DNS
1. 🤖 `cd ~/turbobookings-dashboard && npm run fork -- dtown --push` → `dtown-atv-rentals-site` repo
   (needs Phase 2 done — fork reads the location row + assets).
2. 🤖 wire to the new booking system: add `/book/:path*` → `book.turbobookings.net/dtown/:path*` rewrite;
   repoint every "Book" CTA at `/book/…` (template ships FareHarbor-era links; Dallas skips FareHarbor).
3. 👥 create the Vercel project, set env (tracking IDs, base URL), deploy a preview.
4. 🧑 DNS: point `dtownatvrentals.com` + `www` at Vercel (A/CNAME per Vercel), attach the domain.
   (The domain currently serves an old/parked page — this replaces it.)

## Phase 5 — End-to-end verification, TEST mode 👥
- [ ] `dtownatvrentals.com` loads the branded site.
- [ ] Tour CTA → `/book/…` stays on the domain, shows the funnel (address bar never leaves — first-party tracking).
- [ ] Tour detail: real content, photos, reviews badge, Overview/FAQs/Cancellations.
- [ ] Date/time picker: real slots + "N left"; seat-hold countdown at checkout.
- [ ] Pay with Stripe test card `4242 4242 4242 4242` → confirmation; deposit/tax-on-online/fee match the quote.
- [ ] Booking shows in dashboard Manifest; per-vehicle check-in works.
- [ ] Cancel + policy-aware refund; reschedule — both work.
- [ ] Funnel events fire (view_item → purchase) + server Purchase on the Stripe webhook (if pixels set).
- [ ] (Optional) RBAC: a director/basic_user Clerk account sees only its surfaces.

## Phase 6 — Flip to LIVE 🧑 + 🤖 (only after Phase 5 is clean)

### Pre-flight — verified state 2026-08-16 🤖
| Check | Result |
|---|---|
| Dashboard prod `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | present, **last written 85d ago** (initial setup) — never touched since; Phase 6 has never run ⇒ still **test** |
| Booking-app prod `STRIPE_SECRET_KEY` / publishable | present, **last written 85d ago** ⇒ still **test** |
| Can we read the values back to prove it? | **No.** Both projects have these marked **Sensitive** in Vercel — the value is unreadable via CLI, REST API, and the Vercel UI. Only overwrite is possible. Confirm mode from the **Stripe** side instead (see below). |
| Dashboard prod `STRIPE_WEBHOOK_SECRET` | ✅ **LIVE value, verified 2026-08-18.** Old test-mode var (Preview+Production) removed; re-added Production-scoped. Proven by a *signed* probe → **200 `ok`**, i.e. the signature actually validated — not merely `bad signature`. |
| Booking-app prod `STRIPE_WEBHOOK_SECRET` | ✅ **SET + verified 2026-08-18** (was the blocking gap). Signed probe → **200 `ok`**. |
| Booking-app prod `ADMIN_ENCRYPTION_KEY` | ✅ already set (2d ago) — this runbook item is done |
| Dashboard prod Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_test_…` → frontend API `welcome-muskrat-17.clerk.accounts.dev` = a Clerk **development** instance. Deferred by choice; see "Deferred". |
| `dashboard.turbobookings.net` / `book.turbobookings.net` | ✅ both resolve to Vercel, HTTP 200 |
| `dtownatvrentals.com` | ❌ still on the **old Duda site** (`www` → `multiscreensite.com`); the forked Dallas site is only on `dtown-atv-rentals-site.vercel.app`. Domain is not attached to any Vercel project. **Phase 4.4 DNS is NOT done.** |
| `book.dtownatvrentals.com` | ❌ no DNS record yet |
| Dashboard `main` vs `develop` | ✅ in sync as of 2026-08-18 |
| Booking-app `main` vs `develop` | ✅ in sync — `develop` (5 commits: fee clamp, readiness gate ×2, `external_ref` mirror, lifecycle emails) fast-forwarded to `main` and deployed 2026-08-18 |

**How to prove test-mode from Stripe (10 seconds, 🧑):** Stripe Dashboard → toggle **Live mode** →
Developers → *API request logs*. **Zero** live-mode requests ⇒ both prod apps are still on test keys.
(Test-mode logs should show recent traffic from prod.) Do this before touching anything.

### Stale test-mode state — measured 2026-08-16 🤖
`npm run stripe:preflight` audits this (dry run by default; `--slug=<loc> --commit` purges).

| | dtown | htown | miami |
|---|---|---|---|
| status | **`building`** (not `draft` — this doc was wrong) | `launched` | `launched` |
| Connect account | test `acct_` | none | none |
| retainer | `active`, test `cus_`+`sub_`, visa ••••4242 | inactive | inactive |
| bookings | 3 (2 active, 1 cancelled) | 0 | 0 |
| payments w/ test `pi_` | 3 · $114.40 | 0 | 0 |
| cards on file (test `pm_`) | 3 | 0 | 0 |
| authorized holds | **none** ✅ nothing to drain | 0 | 0 |

Purge is small and safe. Note cards-on-file hang off the **customer**, not the booking
(`added_from_booking_id` is nullable + set-null), so a booking-scoped delete would leave all 3 behind
— the script scopes them by the location's customers.

**Also clear the retainer columns** (`stripe_platform_customer_id`, `stripe_subscription_id`,
`retainer_card_brand`, `retainer_card_last4`, `retainer_status='inactive'`). Mandatory, not cosmetic:
`ensurePlatformCustomer` short-circuits on the stale `cus_` and `startRetainer` is blocked by the
guard at `actions/billing.ts:135`, so without it the operator **cannot re-add a card in live mode**.

### FareHarbor bookings — IMPORTED 2026-08-16 ✅
185 upcoming Dallas bookings (Aug 17 – Nov 6) migrated off FareHarbor into the storefront DB.
Command: `npm run import:fh -- --file=<export.csv> --slug=dtown [--commit]` (dry run by default).

| | |
|---|---|
| Created | **185**, booking numbers `0004`–`0188`, 0 errors, 0 duplicates |
| ATV units | 422 — 365 Single Rider, 57 Double Rider |
| Slots | **185/185 matched an existing slot; none created** |
| Capacity | no slot exceeds the 30-ATV pool |
| Booking value | $59,113.97 |
| Collected by FareHarbor | $8,470.00 |
| **Balance due at the venue** | **$50,643.97** — staff collect this at check-in |
| Emails sent | **none** (no confirmation, no reminders, no review) |

The rider split isn't in the FareHarbor export — it's recovered from the money by solving
`a + b = units, $120a + $190b = subtotal`. 184 of 185 resolve exactly; booking `#372422570`
(discounted) falls back to all-singles with a subtotal override so the customer is never asked a
different amount.

**Reminders are deliberately NOT armed.** When the new system is live and FareHarbor's own reminders
are switched off, run `npm run import:fh -- --slug=dtown --arm-reminders --commit` to schedule
24h/2h reminders for these bookings (no confirmation, no review). Only reminders still in the future
are armed.

**Reporting:** imported bookings carry `source = 'api'` and are excluded from "Collected online" and
the sales-tax report — that money and tax went through FareHarbor, not us. They appear on their own
"Imported (pre-existing)" tile. Their balance due IS counted, because it's real money still to collect.

**Rollback** (if ever needed):
```sql
delete from bookings where location_id = (select id from locations where slug='dtown')
  and external_ref is not null;   -- lines + payments cascade
```

### 6.0 — ✅ RESOLVED 2026-08-18 (was blocking) 🧑
> Both live webhooks now exist and both secrets are verified; the tab-close data-loss window below is closed.

- ~~**Booking-app Stripe webhook is dead in production.**~~ `bookingsystem` prod has no
  `STRIPE_WEBHOOK_SECRET`, so `POST /api/webhooks/stripe` short-circuits with `webhook not configured`
  and Stripe's `payment_intent.succeeded` never commits the booking. Today it only works because the
  success-page fallback also commits — meaning **if a customer closes the tab right after paying, no
  booking row is written, no confirmation email is sent, and the oversell auto-refund never fires.**
  This must be a real webhook endpoint before real money moves. Fixed as part of 6.3 below.

### 6.0b — Full state validation 2026-08-18 🤖
Run against production Neon. **Green = verified working, not assumed.**

| Check | Result |
|---|---|
| Both live webhook secrets | ✅ **signed** probe → `200 ok` on each (see 6.1 step 6 for method) |
| Readiness gate | ✅ `/dtown` 200 · `/htown` 404 · `/miami` 404 |
| Imported FareHarbor bookings | ✅ **185 intact**, all `status=active`, `source=api`, `external_ref` set |
| Dallas catalog | ✅ 1 item `D-Town ATV Tour`, bookable + listed, **6,481 availabilities** |
| Booking coverage | ✅ 188 bookings across 80 slots, through 2026-11-06 |
| Reminder emails on imports | ✅ **0 pending** — import ran with reminders off, as intended |
| `bookingsystem` main | ✅ in sync with develop, deployed |

**Four things that are NOT clean and must be handled before/at go-live:**

1. 🔴 **`retainer_status='active'` for Dallas is STALE and will not self-correct.**
   `stripe_subscription_id=sub_1U4qwV…` / `stripe_platform_customer_id=cus_V50xwA…` are **test-mode**
   objects. Now that the platform is on live keys, those IDs don't exist, and the live
   `dashboard-retainer-subscriptions` endpoint will never emit an event carrying them — so
   `setStatusBySubscription` can never match the row. The dashboard will keep displaying a healthy
   retainer for a subscription that isn't billing anyone. Step 7 (re-add card in live mode) is what
   fixes it; until then treat this field as **lying**.

2. 🟠 **Three test-mode bookings sit in production Dallas data** — `0001` (cancelled), `0002`, `0003`
   (both **active**), created 2026-08-09/11/14, each with a test-mode `pi_…`. They will appear on the
   manifest as real bookings. Purge before go-live — target `external_ref IS NULL` **and** a payment
   row exists, never a bare `external_ref IS NULL` (that would take the 185 imports with it).

3. 🟠 **Turning reminders on will NOT backfill the 185 imported bookings.** `scheduled_emails` has zero
   pending rows; the importer deliberately scheduled none. Flipping the switch arms *future* bookings
   only. Decide explicitly whether the imported guests should get reminders — if yes, that needs a
   backfill, not a toggle.

4. 🟡 **Cockpit feed is dormant: 16 queued events, `max(attempt_count)=0`** — oldest 2026-06-28, newest
   2026-08-17. Never attempted, because `BRAIN_WEBHOOK_URL` is unset. Expected, but it means the
   revenue feed has *never* been exercised end-to-end; the first real test is when the Railway URL
   lands. Budget time for it to fail the first time.

**Also fixed on 2026-08-18:** local `.env.local` still held the **pre-rotation** Neon password, so
every CLI script in this repo (importer, Stripe pre-flight, Clerk role sync) failed with
`password authentication failed`. Refreshed from `vercel env pull`. This is the same drift class as
the booking-app `DATABASE_URL` incident — a second instance, which is why the Phase 1 guardrails in
`~/.claude/plans/we-are-still-currently-zippy-panda.md` matter. **If a script suddenly can't reach the
DB, re-pull `.env.local` before debugging anything else.**

### 6.0c — Test-data cleanup + reminder backfill, done 2026-08-18 🤖
| Action | Result |
|---|---|
| Purge test-mode bookings | ✅ 3 deleted (`0001`–`0003`), **185 imports verified intact** — `scripts/purge-test-bookings.ts` |
| Arm reminders on imports | ✅ 354 armed (176 × 24h, 178 × 2h) — `scripts/backfill-import-reminders.ts` |
| Reset retainer for live mode | ✅ **done + independently verified** — `npm run retainer:reset -- dtown --commit` |

**Reminder backfill notes.** All 185 imports had real email addresses (zero
`@import.invalid`), so nothing was skipped for that reason. Confirmation and
post-tour-review stay **off** by design — these guests already received the old
system's confirmation and never booked through us. Sends spread naturally across
the existing booking calendar (peak 77 on 2026-08-22), so there is no burst /
domain-reputation risk. Reminder content carries no payment claim, which matters
because ~$50k is still owed at the venue on these bookings.

There is **no location-level on/off switch** for this: `loadTemplate` returns
`{ enabled: true }` when no `email_templates` row exists (context.ts:80), and
Dallas has no rows. Inserting `scheduled_emails` rows *is* arming them. To
suppress a type, create an `email_templates` row with `enabled = false`.

**Retainer reset verified 2026-08-18:** `stripe_subscription_id`,
`stripe_platform_customer_id`, `retainer_card_brand`, `retainer_card_last4` all
cleared; status `active` → `inactive`; 3 × `4242` test cards removed;
`retainer_cents` (325000) and `retainer_billing_day` (15) preserved; Connect
account `acct_1U5aMoCxXcDic9eT` **untouched** (it must survive — it is Richard's
live onboarding). Post-state: 185 imports, 0 native bookings, 354 reminders
pending. `startRetainer()` will now run instead of refusing.

### 6.0d — Clerk is still on a DEVELOPMENT instance (measured 2026-08-18) 🧑
Vercel production carries `pk_test_…` → `welcome-muskrat-17.clerk.accounts.dev`. Full plan in
`~/.claude/plans/we-are-still-currently-zippy-panda.md`. Grant map exported to
`clerk-roles-backup.json` (gitignored — it is the complete RBAC map plus every pending invite email).

**Three traps, all verified in code:**
1. **Bootstrap lockout.** `src/lib/auth/roles.ts:50-57` fails closed and `RoleGate.tsx` blocks anyone
   with no role. A fresh production instance has zero users — sign up, then set
   `publicMetadata.role = "master"` from the Clerk dashboard *before anything else*, or nobody
   (including you) can grant roles.
2. **The cockpit SPA's key is baked at Docker BUILD time** from the committed
   `cockpit/web/.env.production` (`~/ads/SHARED/Dockerfile:10` is still a TODO). A Railway env var
   fixes the backend only — sign-in appears to work while every API call 401s.
3. **The cockpit's role claim needs a per-instance session-token template.** `cockpit/auth.py:79-85`
   reads `cockpitRole` from JWT claims, never from the Clerk API. Templates do not carry over; miss it
   and everyone silently drops to `role="creative"`. `COCKPIT_OWNER_IDS` also holds dev user IDs.

**Users do NOT transfer between Clerk instances** — separate databases by design. Re-created via
`npm run clerk:import-roles`.

**Two users have two email addresses; the export uses the PRIMARY.** `andresantanacsx@gmail.com`
(not `andre.santanacsx@`) and `oscar@turbobookings.net` (not `oscar@yourmusicmanager.com`). They
should sign up with the primary, or the import invites instead of updating — same role either way.

**⚠️ The export MISSES users who rely on a default role.** `clerk-export-roles.ts` skips any user with
empty `publicMetadata` — but in the cockpit, empty metadata IS a role:
`cockpit/auth.py:79-85` falls back to `role = "creative"`. So
`joshuelespinoza@gmail.com` (creative director, cockpit-only, no dashboard access) has `{}` metadata
and is **absent from the backup entirely** — migrating from the export alone would silently drop him.
He must be invited to the production instance by hand; there is nothing to replay, and that is
correct. Check for any other cockpit-only users before cutover.

### 6.1 — Order of operations
1. 🧑 **Register `book.dtownatvrentals.com`** → attach to the `bookingsystem` Vercel project, point DNS.
   Then 🤖 repoints `BOOKING_ORIGIN` / `BOOKING_APP` in `dtown-atv-rentals-site` (`next.config.ts` +
   `src/lib/booking.ts`) off `book.turbobookings.net/dtown`. This is what makes booking cookies
   **first-party** (same registrable domain) — do it *before* ad spend, not after.
2. 🧑 **Point `dtownatvrentals.com` + `www` at Vercel** and attach to `dtown-atv-rentals-site`
   (replaces the current Duda page). Verify the branded site serves on the apex.
3. 👥 **Promote code:** merge dashboard `develop` → `main` (2 commits) so prod runs the latest build.
   *Requires explicit go-ahead — nothing merges to `main` without it.*
4. 🧑 **Stripe live Connect onboarding** for the real Dallas business (bank + business details) on the
   **live** platform account. Note the new live `acct_…`.
5. 🧑 **Swap Stripe keys to live** — `sk_live`/`pk_live` in **both** Vercel projects (Production scope):
   `bookingsystem` and `turbo-bookings-dashboard`. Redeploy both.
6. ✅ **DONE 2026-08-18 — LIVE-mode webhooks created** (test-mode endpoints do **not** carry over):
   | Destination | ID | Scope | Events | Secret |
   |---|---|---|---|---|
   | `booking-app-payments` → `https://book.turbobookings.net/api/webhooks/stripe` | `we_1U5eQFE69fk80FRq0qBmoTI5` | **Connected accounts** | `payment_intent.succeeded` | `bookingsystem` → `STRIPE_WEBHOOK_SECRET` (Production, new var) ✅ |
   | `dashboard-retainer-subscriptions` → `https://dashboard.turbobookings.net/api/webhooks/stripe` | `we_1U5eUFE69fk80FRq1tlWeB7f` | **Your account** | `customer.subscription.created` / `.updated` / `.deleted` | `turbo-bookings-dashboard` → `STRIPE_WEBHOOK_SECRET` (Production, replaced test value) ✅ |

   Both redeployed. **Three deliberate decisions worth knowing:**
   - **API version set to `2026-07-29.dahlia`, not the account default `2019-09-09`.** The SDK speaks a
     2026 version; a 7-year-old payload shape risks field mismatches on `payment_intent.succeeded`.
   - **Scope is not symmetric and must not be "fixed" to match.** The booking app takes *direct charges
     on connected accounts*, so it needs Connected-accounts scope (`event.account` is read in the
     handler). The retainer is billed on the *platform* account, so it needs Your-account scope.
     Swapping either one silently delivers nothing.
   - **`invoice.payment_failed`/`succeeded` were deliberately NOT subscribed** (this runbook previously
     called for them). The handler's `switch` ignores them; Stripe sets `subscription.status` to
     `past_due` on a failed invoice and back to `active` on recovery, each firing
     `customer.subscription.updated` — so the three subscription events already cover every transition.

   **Verification method — use this, not "Send test webhook".** An *unsigned* probe returning
   `bad signature` only proves *a* secret exists, not the *right* one. Send a properly signed event
   with a type the handler ignores (e.g. `balance.available`) and expect **200 `ok`** — that proves
   HMAC validation passed with zero side effects. Never probe the booking app with a signed
   `payment_intent.succeeded`: that hits the real commit path.
   *(Endpoint URL stays `book.turbobookings.net` until step 1's DNS lands; update it then.)*
7. 🧑 **Re-add the retainer card in live mode.** ✅ *Prerequisite reset done
   2026-08-18.* Order matters: **card first, then Start retainer** —
   `startSubscription()` throws `"No card on file"` when
   `stripePlatformCustomerId` is null, which it now is. Adding the card creates
   the live customer; Start writes the live `sub_…`, which is what reconnects the
   webhook. Historical note: Dallas held
   test-mode `stripe_subscription_id` / `stripe_platform_customer_id`, and
   `startRetainer()` (`lib/actions/billing.ts:135`) refuses to run while a
   subscription ID is present and status is not `canceled` — so the UI will tell
   you a retainer is already running and block the live setup. The script clears
   the stale Stripe references and the `4242` test cards while **preserving**
   `retainer_cents` / `retainer_billing_day` ($3,250, day 15). (the test-mode customer/subscription does not carry over):
   operator saves the card again, admin re-sets $3,250 / day 15, confirm `retainer_status` → `active`.
8. 🤖 **Update the Dallas connected account** to the live `acct_…` and flip location
   `building` → `launched`.
9. 👥 **One real-card booking end-to-end**, then refund it: confirm the charge lands in the Dallas live
   Stripe balance, the platform 6% fee lands on the platform account, the manifest shows the booking,
   the confirmation email arrives, and the refund returns to the card.
10. 🧑 Go public (ads / share).

### Code changes that shipped with this cutover (on `develop`)
- **Application fee is clamped** to the charge in the customer checkout
  (`bookingsystem/src/lib/actions/checkout.ts`). It was computed on the full adjusted subtotal while
  the charge is only what's due online — under `platform_fee_mode = 'absorbed_by_client'` it could
  exceed `amount` and Stripe would reject the PaymentIntent outright.
- **No silent platform-account fallback.** `dashboard/src/lib/stripe/payments.ts` used to fall back to
  the platform account when a location had no connected `acct_`, so refunds came out of *our* balance
  and holds authorized against the wrong merchant — with no application fee taken on charges. All
  payment ops now fail loudly. This matters precisely during the window between clearing the stale
  test `acct_` and finishing live onboarding.
- Schema drift fixed: `payments.stripe_payment_intent_id` is nullable (since migration 0016); the
  booking engine still declared it `notNull`.

### Rollback
Steps 5–8 are reversible: put the `sk_test`/`pk_test` values back, flip the location to `draft`, redeploy.
Anything already charged on a live card must be refunded in Stripe — it does not roll back with the env.

### Test → live key swap
| Service | Variable | Where | Now | Phase 6 |
|---|---|---|---|---|
| Stripe | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | booking app + dashboard | `pk_test_…` | `pk_live_…` |
| Stripe | `STRIPE_SECRET_KEY` | booking app + dashboard | `sk_test_…` | `sk_live_…` |
| Stripe Connect | connected account | dashboard → Integrations | test acct | live onboarding |
| Clerk | publishable/secret | dashboard | `pk_test_…` (dev instance) | `pk_live_…` — see Phase 7 |
| Brain pipe | `BRAIN_WEBHOOK_URL`/`_SECRET` | booking app | unset → queues | Railway URL when ready |

> **Secrets:** set every value directly in Vercel project env — never paste live secret keys into chat or commit them.

## Phase 7 — Clerk dev → PRODUCTION instance 🧑 + 🤖

### ⚠️ This is NOT a dashboard-only change — audited in the Clerk dashboard 2026-08-17

The **ads cockpit** (Railway) runs on the **same Clerk instance** — same publishable key
(`pk_test_d2VsY29t…` → `welcome-muskrat-17.clerk.accounts.dev`); `cockpit/web/.env.production` says so
outright. `cockpit/auth.py` derives the JWT issuer from that key and validates every token against it,
so switching the dashboard alone **locks users out of the cockpit**. Both must move in one window.

**Blockers found by inspection (not assumption):**

| Blocker | Evidence | Cost |
|---|---|---|
| **Google OAuth uses Clerk's SHARED credentials** | Configure → SSO connections shows `Shared credentials` + Clerk's own notice: *"You'll need to add custom credentials for your SSO connections in production"* | Own Google Cloud OAuth client: project, consent screen, client ID/secret, redirect URI. Minutes if you stay internal/testing; **days** if Google has to verify an external consent screen. |
| **`COCKPIT_OWNER_IDS` is an allowlist of Clerk USER IDs** | `cockpit/auth.py:38` — `sub in OWNER_IDS → role = "owner"` | Clerk user IDs do **not** survive a dev→prod move. After cutover the allowlist matches nobody, and with session claims empty (below) the owner falls back to `"creative"` — locked out of approvals, analyst, factpack, build, market. **Must be repopulated with the new prod user IDs.** |
| **Session token claims are empty (`{}`)** | Configure → Sessions → Customize session token | `auth.py` reads `cockpitRole` from a token claim and finds nothing, which is exactly why the owner allowlist exists. Nothing to migrate, but don't expect the claim path to work. |
| **`VITE_CLERK_PUBLISHABLE_KEY` is baked in at build time** | `cockpit/web/.env.production`, Vite `VITE_` prefix | The cockpit SPA needs a **rebuild + redeploy**, not just an env change. |
| **Hobby plan with Pro features enabled** | Sessions → `Maximum lifetime` (7 days) is ON and badged `Pro`; the clone dialog warns *"Usage of premium features will require a plan upgrade"* | Decide the plan before cloning, or lose the setting. |
| DNS + SSL for the prod custom domain | Clerk issues CNAMEs for `turbobookings.net` | 15 min – a few hours of propagation/verification. |

**Cockpit cutover checklist (same window as the dashboard):**
1. `VITE_CLERK_PUBLISHABLE_KEY` → `pk_live_…`, then **rebuild** the SPA and redeploy.
2. `CLERK_PUBLISHABLE_KEY` / `CLERK_ISSUER` → prod, so JWKS + issuer validation point at the new instance.
3. **`COCKPIT_OWNER_IDS` → the new prod Clerk user ID(s).** Get them from the prod instance after sign-up.
4. Verify: owner reaches `/api/approvals`; the creative director still reaches analyst chat/thread/last.

**Current instance (2026-08-17):** 3 users — `selmen@` (dashboard `master`, `cockpitRole: owner`),
`oscar@` (dashboard `admin`, no cockpitRole → cockpit least-privilege), `joshuelespinoza@gmail.com`
(no publicMetadata at all → cockpit `creative` by default, no dashboard access). Access mode
**Invite-only**. So re-registration is trivial in volume; the risk is entirely in the wiring above.


Code-side this is **only an env swap** — no Clerk Organizations, no Clerk webhook, no hardcoded hosts,
and `grep process.env.*CLERK` in `src` returns nothing (the SDK reads the two vars implicitly).
The risk is entirely in the **data**: a production instance starts empty, and all RBAC lives in Clerk
`publicMetadata` with nothing mirrored in Postgres.

**Measured via `npm run clerk:export-roles`:**

| Account | Dashboard role | Per-location | `cockpitRole` |
|---|---|---|---|
| `selmen@turbobookings.net` | `master` | none | **`owner`** |
| `oscar@turbobookings.net` | `admin` | none | — (least privilege) |

Zero `locationRoles` to replay, no pending invitations. The export now captures the **entire**
`publicMetadata` object rather than just the dashboard's own keys — it previously dropped
`cockpitRole`, which would have silently demoted the cockpit owner to creative-only at cutover.

1. 🤖 `npm run clerk:export-roles -- --out=<path>` against the **dev** instance. **Do this first** —
   after cutover the grants are gone. (Already run once; re-run for a fresh backup at cutover time.)
2. 🧑 Create the Clerk **production** instance; add the DNS records Clerk issues on `turbobookings.net`
   (frontend API + accounts portal + DKIM/mail CNAMEs).
3. 🧑 Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` (Production scope), redeploy.
4. 🧑 **Break the bootstrap lockout before anything else:** sign up, then set
   `publicMetadata.role = "master"` by hand in the Clerk dashboard. Role resolution **fails closed**
   (`roles.ts:50-57`) and `RoleGate` blocks anyone with no role — so until a master exists, *nobody*
   can administer anything, including re-granting roles.
5. 🤖 `npm run clerk:import-roles -- --in=<path>` (dry run; add `--commit` to apply) against the
   production instance. Existing users are merge-updated; everyone else gets an invitation with the
   role pre-baked into `publicMetadata` so it applies at sign-up.
6. 🧑 Verify: master sees all locations; sign out and back in cleanly.

**Known cosmetic fallout:** `audit_log.user_id` rows keep dev-instance IDs. `ActivityFeed` already
try/catches the lookup and degrades to an 8-char stub — no crash. `bookings.created_by_user_id` and
`booking_reschedules.performed_by_user_id` are write-only (never read back), so they're harmless.

### Deferred / not blocking launch
*(The Clerk production cutover was previously deferred here — it is now **Phase 7** above, at the
operator's direction.)*
- Wiring the Railway brain's `BRAIN_WEBHOOK_*` (until then booking events queue; no transactional email/SMS sends).
- Priced quantity add-ons (post-launch, per the roadmap).
