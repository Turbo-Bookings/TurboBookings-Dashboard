# Tracking & Attribution (canonical)

> **This file lives in SEVEN repos.** Everything from the "How attribution works" heading down is
> SHARED and must stay byte-identical; everything above it is that repo's own notes.
> `turbobookings-dashboard` holds the canonical copy — edit the shared half there, then:
>
> ```bash
> npm run docs:sync -- --write   # from turbobookings-dashboard
> npm run docs:check             # exits 1 if any copy has drifted
> ```

## This repo's tracking role

The dashboard **owns `tracking_config`** (the per-location table that gates every server-side event),
the Storefront DB columns that store attribution (`customers.first_attribution_click_*`,
`bookings.last_attribution_click_*`), and the outbound event queue that ships `booking.created` to the
cockpit. It fires no browser pixels of its own — it is an internal admin surface.

If you are changing what a customer's browser sends, you are in the wrong repo: marketing-site events
live in the three site repos, and checkout events live in `bookingsystem`.

## How attribution works (read this first)

> 🔒 **Everything from this heading down is SHARED across seven repos and is overwritten by
> `npm run docs:sync -- --write` in `turbobookings-dashboard`.** Edit it THERE, not here — a local
> edit below this line will be silently discarded on the next sync.

One ad click has to survive four hops to become an attributed booking. Each hop has its own failure
mode, and they are not interchangeable.

```
1. AD CLICK lands on the marketing site
   ad-tracking.ts captureAdClickFromUrl()  → localStorage <slug>.ad_click / .ad_click_first
   cookies.ts     captureFbclid()          → _fbc cookie on the REGISTRABLE domain
   (Google writes _gcl_aw itself, same scope)

2. DECORATOR appends params to Book CTAs
   BookingLinkDecorator → decorateBookingUrl (ad-tracking.ts)
   Selector is a[href*="${LINKER_DOMAIN}"] where LINKER_DOMAIN = hostname of BOOKING_ORIGIN.
   ⚠️ A link that does not contain that hostname is NEVER decorated. See TRK-07.

3. BOOKING APP promotes URL → cookie
   bookingsystem/src/proxy.ts  (Next 16: the file is proxy.ts exporting `proxy`, not middleware.ts)
     tb_click_first  write-once, from ?tb_first= or the native params   ← first touch
     tb_click_last   overwritten by any newer click                     ← last touch
     tb_aid          anonymous id
   90-day TTL, httpOnly, sameSite=lax, widened to the registrable domain by cookieDomainFor().

4. CHECKOUT → DB
   checkout.ts stashes _fbp/_fbc/_gcl_aw/tb_click_* onto Stripe PaymentIntent metadata,
   commit.ts resolveClick() prefers our cookie, then legacy, then derives from _fbc / _gcl_aw, then
     customers.first_attribution_click_id/_type   INSERT-ONLY (deliberately absent from
                                                  onConflictDoUpdate — first touch wins per person)
     bookings.last_attribution_click_id/_type     per booking
   after.ts puts all four on the booking.created envelope → cockpit.
```

**The single most important structural fact:** all three markets serve their booking app from the
**same registrable domain** as the marketing site (`dtownatvrentals.com` → `book.dtownatvrentals.com`,
and likewise for Houston and Miami). That is why `_fbc`, `_ga` and `_gcl_aw` carry at all. If a future
location is ever pointed at `book.turbobookings.net`, cookie-based attribution dies silently and the
URL-param path becomes the only channel.

### Per-market state (verified 2026-09-04)

| | Miami (`miami`) | Houston (`htown`) | Dallas (`dtown`) |
| --- | --- | --- | --- |
| Site | takeoversmiamiatvrentals.com | htownatvrentals.org | dtownatvrentals.com |
| Booking origin | book.takeoversmiamiatvrentals.com | book.htownatvrentals.org | book.dtownatvrentals.com |
| Meta pixel | 516637097197570 | 1516241692811826 | 25974101692226269 |
| GA4 | G-W1737CSQ2C | G-BQQMF72HGR | **none** |
| Google Ads | AW-10789560857 / jpTBCNiXqeUcEJnE7pgo | AW-10833387733 / lJydCJiOk-UcENXB4a0o | **none** |
| GTM | GTM-PNVZ2GWD | (component present but inert) | none |
| CAPI Purchase | on | on | on |
| Tracking mode | direct | direct | direct |

> ⚠️ **Dallas runs Meta only, and that is a decision — not a defect.** `ads/SHARED/accounts.md` lists
> its Google Ads account as `_TBD_`, `tracking_config` has no GA4 or Ads ID, and Dallas has never
> recorded a single `gclid` or `gbraid` in its entire booking history. Its lower TOTAL click-ID
> capture is channel mix. On Meta alone it is level with Miami and ahead of Houston. This was
> mis-diagnosed as a Dallas tracking failure on 2026-09-04; do not repeat that.

### Click-ID capture baseline

Capture shipped **2026-08-28 06:05 UTC** in a single deploy across all three markets. **Any window
that starts before that date understates capture**, because the column simply did not exist.
Measured 2026-08-28 → 2026-09-04, online bookings only:

| | bookings | any click ID | fbclid | gclid + gbraid |
| --- | --- | --- | --- | --- |
| dtown | 239 | 22.2% | 22.2% | 0 (no Google account) |
| htown | 352 | 61.4% | 16.2% | 45.2% |
| miami | 160 | 50.6% | 23.1% | 27.5% |

### Meta Event Match Quality baseline

Measured **2026-08-22 → 2026-09-03 only** — after all three cut over to the custom booking system on
2026-08-21. **Do not read EMQ over a window spanning that date**: Miami's `InitiateCheckout` reads
17.4K over Aug 7–Sep 3 but 1.9K post-cutover, because the wider window is overwhelmingly FareHarbor.
EMQ scores themselves were stable across both windows; only the volumes moved.

Meta reports **$15,141 of ad spend affected by low data quality** — miami $4,202, htown $7,333,
dtown $3,606.

| Event | miami | htown | dtown |
| --- | --- | --- | --- |
| Purchase | 9.2 (673) | 9.2 (1.8K) | 9.1 (1.4K) |
| Add payment info | no score — Pixel only (371) | 9.3 (1.0K) | 9.3 (771) |
| Lead | absent | absent | 7.7 (2.0K) |
| Add to cart | 6.1 (1.1K) | 6.1 (1.4K) | 6.1 (1.4K) |
| BookClick | 6.0 (12.3K) | 6.1 (25.3K) | 6.3 (14.4K) |
| Initiate checkout | 5.9 (1.9K) | 6.1 (4.5K) | 6.1 (2.5K) |
| View content | 5.9 (20.2K) | 6.1 (40.5K) | 6.1 (34.5K) |
| PageView | 5.3 (49.7K) | 6.1 (97.7K) | 6.1 (75.2K) |
| ViewedATVPricing | 4.3 | 6.1 | 6.2 |
| ViewedUTVPricing | 4.2 | 6.1 | — |
| ChatBookingLinkSent | 4.0 | — | — |

**Read the cliff, not the individual numbers.** Every event that fires *after* the checkout email
`onBlur` scores **9.1–9.3**; every event before it scores **4.0–6.3**. That boundary is exactly
`setAdvancedMatching` (`CheckoutForm.tsx`). It is worth roughly three EMQ points, and it also bounds
the fix: `AddToCart` fires on a tour page where no email exists yet, so it cannot reach 9 by adding
PII to the server payload.

Confirming the architecture works: Meta reports **+100% more conversions for Purchase** from running
CAPI alongside the Pixel, on both Miami and Dallas.

### Measurement traps — read before quoting any number

1. **Click-ID capture began 2026-08-28.** Earlier windows understate it.
2. **The booking-system cutover was 2026-08-21.** Any Meta funnel count spanning it mixes FareHarbor
   and custom-checkout events, most severely for Miami.
3. **`verifyTracking()` greps server-rendered HTML.** A green verification proves an ID is present and
   correctly spelled. It does **not** prove a single event fired.
4. **Houston's 0.67x Meta capture is not settleable with observational data.** ~60% view-through share
   makes it an incrementality question; it needs a geo or audience holdout, not a code fix. Note
   Houston's `fbclid` rate is the *lowest* of the three despite the most favourable cookie setup —
   consistent with incrementality rather than leakage.
5. **CAPI is young.** `resolveTokens()` was hard-stubbed to null until 2026-08-13; phone hashing was
   wrong until 08-20; Purchase responses were unchecked until 08-21. Anything measured before those
   dates describes a different system.
6. **`~/takeovers-platform` is Miami only.** Any measurement taken there describes Miami and nothing
   else.

### Fix log

Every finding gets a stable ID and is never deleted — only closed, with the commit that closed it and
a line saying how it was proven fixed. If you find something new, append it; do not renumber.

| ID | Finding | Status | Closed by | Date |
| --- | --- | --- | --- | --- |
| TRK-01 | Mid-funnel CAPI (`AddToCart`/`InitiateCheckout`) carries no hashed PII, so it sits ~3 EMQ points below Purchase | open | | |
| TRK-02 | No `event_source_url` on any `bookingsystem` server event. Meta flags it: miami 90% of events / 4 ad sets (detected 08-22), dtown 57% / 1 ad set (detected 08-18) | open | | |
| TRK-03 | No `content_ids` on the server Purchase, though mid-funnel has them and `items` is in scope | open | | |
| TRK-04 | Mid-funnel and Lead responses never inspected (bare `await fetch`) — an expired token fails silently on two of three paths | open | | |
| TRK-05 | Dallas GA4 cross-domain linker missing | open | | |
| TRK-06 | **No repo sets `allow_linker`** — Miami's and Houston's linker has no receiver, so cross-domain stitching is broken everywhere, not just Dallas | open | | |
| TRK-07 | Dallas chatbot emits `https://www.dtownatvrentals.com/book`, which the decorator's `LINKER_DOMAIN` selector cannot match — costs first-touch and UTMs (not fbclid; the cookie carries) | open | | |
| TRK-08 | Dallas `FALLBACK_ORIGIN = book.turbobookings.net` — never fires in production, but turns a missing env var into silent off-domain traffic instead of a loud failure | open | | |
| TRK-09 | `tb_aid` cookie set without a domain, and never appended to any booking URL — so it has no producer | open | | |
| TRK-10 | `ga_client_id` / `ga_session_id` appended by the decorator, never read by the booking app | open | | |
| TRK-11 | Graph API version drift — `bookingsystem` v19.0, marketing sites v21.0 | open | | |
| TRK-12 | A plain (non-`--custom-booking`) fork ships Miami's LIVE pixel, GA4 property and Ads account | open | | |
| TRK-13 | Template redirect `MAPPINGS` are not host-constrained, so a fork 301s its own pages to Miami. `lint:brand` misses it (`\btakeoversmiami\b` does not match inside `takeoversmiamiatvrentals`) | open | | |
| TRK-14 | Low `fbp` coverage through CAPI (Meta's own diagnostic). Likely downstream of TRK-09 — fix that first and re-measure | open | | |
| TRK-15 | Meta names the exact missing parameter: Email on `ViewContent` (miami, +3.47% median) and on `AddToCart` (dtown, +9.31% median) | open | | |
| TRK-16 | Dallas domain verification outstanding since 2026-06-04 — `dtownatvrentals.com` unconfirmed in Business Settings | **won't do** — operator confirmed 2026-09-04 the domain no longer needs verifying; do not re-raise it | n/a | 2026-09-04 |
| TRK-17 | Miami's `AddPaymentInfo` is Pixel-only with no EMQ score, where both forks show "Multiple" at 9.3 | open | | |
| TRK-18 | Miami fires zero `Lead` events despite `EmailPopup` → CAPI Lead being wired in its layout; Dallas fires 2.0K | open | | |
| TRK-19 | `AddToCart` sits BELOW `InitiateCheckout` in all three markets, though you must select a slot to reach checkout — needs verification, not assumed | open | | |
| TRK-20 | Miami — the template every fork is built from — scores below both forks on every shared event | open | | |
| TRK-21 | Dallas emits an `__missing_event` (13 events, Pixel) | open | | |

### Settled decisions — do not re-litigate

- **Google Ads primary conversion switched 2026-08-31** from the GA4 import to the booking-system
  `Purchase - Booking System` action, on both Houston and Miami. Applied atomically per account; all
  11 enabled campaigns verified on the account-default `PURCHASE/WEBSITE` goal.
  - ⚠️ Expect **~15% more reported conversion value with no real change in bookings** — that step is
    accounting, not performance. It moves Houston's efficiency-derived tROAS floor ~402% → ~458%.
  - Review date: **2026-09-14**.
  - Never leave two Primary purchase actions: they do not dedupe against each other, so bidding would
    count every sale twice.
- **Dallas is intentionally Meta-only** (see above).
- **The Intelligence DB does not exist yet.** The cockpit's revenue lives in one SQLite table on the
  Railway volume, fed by `POST /api/webhooks/turbobookings`. Per-campaign attribution is cockpit
  project #25 and is not built. Do not plan against a shared Neon path.
