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
| Dashboard prod `STRIPE_WEBHOOK_SECRET` | **set** (added 19h ago = the TEST-mode retainer endpoint). Probe: signed POST → `bad signature` (reaches verification). |
| Booking-app prod `STRIPE_WEBHOOK_SECRET` | ❌ **NOT SET IN ANY ENV.** Probe: signed POST → `webhook not configured`. **Blocking — see 6.0.** |
| Booking-app prod `ADMIN_ENCRYPTION_KEY` | ✅ already set (2d ago) — this runbook item is done |
| Dashboard prod Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` = `pk_test_…` → frontend API `welcome-muskrat-17.clerk.accounts.dev` = a Clerk **development** instance. Deferred by choice; see "Deferred". |
| `dashboard.turbobookings.net` / `book.turbobookings.net` | ✅ both resolve to Vercel, HTTP 200 |
| `dtownatvrentals.com` | ❌ still on the **old Duda site** (`www` → `multiscreensite.com`); the forked Dallas site is only on `dtown-atv-rentals-site.vercel.app`. Domain is not attached to any Vercel project. **Phase 4.4 DNS is NOT done.** |
| `book.dtownatvrentals.com` | ❌ no DNS record yet |
| Dashboard `main` vs `develop` | `main` is **2 commits behind** (sales-tax report + docs) — production is not running the latest build |
| Booking-app `main` vs `develop` | in sync ✅ |

**How to prove test-mode from Stripe (10 seconds, 🧑):** Stripe Dashboard → toggle **Live mode** →
Developers → *API request logs*. **Zero** live-mode requests ⇒ both prod apps are still on test keys.
(Test-mode logs should show recent traffic from prod.) Do this before touching anything.

### 6.0 — Fix first (blocking) 🧑
- **Booking-app Stripe webhook is dead in production.** `bookingsystem` prod has no
  `STRIPE_WEBHOOK_SECRET`, so `POST /api/webhooks/stripe` short-circuits with `webhook not configured`
  and Stripe's `payment_intent.succeeded` never commits the booking. Today it only works because the
  success-page fallback also commits — meaning **if a customer closes the tab right after paying, no
  booking row is written, no confirmation email is sent, and the oversell auto-refund never fires.**
  This must be a real webhook endpoint before real money moves. Fixed as part of 6.3 below.

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
6. 🧑 **Create the LIVE-mode webhooks** (test-mode endpoints do **not** carry over):
   | Endpoint | Events | Secret goes to |
   |---|---|---|
   | `https://book.dtownatvrentals.com/api/webhooks/stripe` (or `book.turbobookings.net` until step 1 lands) | `payment_intent.succeeded` — **check "listen to events on Connected accounts"** | `bookingsystem` → `STRIPE_WEBHOOK_SECRET` (Production) — *new var, see 6.0* |
   | `https://dashboard.turbobookings.net/api/webhooks/stripe` | `customer.subscription.created/updated/deleted`, `invoice.payment_failed`/`succeeded` | `turbo-bookings-dashboard` → `STRIPE_WEBHOOK_SECRET` (Production) — replaces the test value |
   Redeploy both after setting the secrets. Verify each with Stripe's **Send test webhook** → expect **200**.
7. 🧑 **Re-add the retainer card in live mode** (the test-mode customer/subscription does not carry over):
   operator saves the card again, admin re-sets $3,250 / day 15, confirm `retainer_status` → `active`.
8. 🤖 **Update the Dallas connected account** to the live `acct_…` and flip location `draft` → `launched`.
9. 👥 **One real-card booking end-to-end**, then refund it: confirm the charge lands in the Dallas live
   Stripe balance, the platform 6% fee lands on the platform account, the manifest shows the booking,
   the confirmation email arrives, and the refund returns to the card.
10. 🧑 Go public (ads / share).

### Rollback
Steps 5–8 are reversible: put the `sk_test`/`pk_test` values back, flip the location to `draft`, redeploy.
Anything already charged on a live card must be refunded in Stripe — it does not roll back with the env.

### Test → live key swap
| Service | Variable | Where | Now | Phase 6 |
|---|---|---|---|---|
| Stripe | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | booking app + dashboard | `pk_test_…` | `pk_live_…` |
| Stripe | `STRIPE_SECRET_KEY` | booking app + dashboard | `sk_test_…` | `sk_live_…` |
| Stripe Connect | connected account | dashboard → Integrations | test acct | live onboarding |
| Clerk | publishable/secret | dashboard | `pk_test_…` | later (optional) |
| Brain pipe | `BRAIN_WEBHOOK_URL`/`_SECRET` | booking app | unset → queues | Railway URL when ready |

> **Secrets:** set every value directly in Vercel project env — never paste live secret keys into chat or commit them.

### Deferred / not blocking launch
- Clerk **production** instance for the dashboard (operator chose to keep the test instance for the soft
  launch). Confirmed still a **dev** instance as of 2026-08-16 (`…clerk.accounts.dev`). Caveats while
  deferred: dev instances are capped (~100 users), sign-in runs through the `.accounts.dev` host, and
  sessions/JWTs are dev-grade. Fine for operator + a handful of staff; revisit before client logins scale.
- Wiring the Railway brain's `BRAIN_WEBHOOK_*` (until then booking events queue; no transactional email/SMS sends).
- Priced quantity add-ons (post-launch, per the roadmap).
