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
1. 🧑 complete Stripe **live** Connect onboarding for the real Dallas business (real bank/business details).
2. 🧑 swap Stripe keys to `pk_live`/`sk_live` on booking app **and** dashboard prod env; redeploy; remove test keys.
3. 🤖 flip Dallas status `draft` → `launched`.
4. 👥 one real-card test booking end-to-end, then refund it.
5. 🧑 go public (ads / share).

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
- Clerk **production** instance for the dashboard (operator chose to keep the test instance for the soft launch).
- Wiring the Railway brain's `BRAIN_WEBHOOK_*` (until then booking events queue; no transactional email/SMS sends).
- Priced quantity add-ons (post-launch, per the roadmap).
