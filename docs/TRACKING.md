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
| TRK-01 | Mid-funnel CAPI carries no hashed PII | **partly closed, and the framing was wrong.** `AddToCart`/`InitiateCheckout` fire BEFORE the shopper types anything, so no identity exists to send — the browser pixel has none either, and no server payload work changes that. Confirmed by the EMQ cliff: everything after the email blur scores 9.1–9.3, everything before it 4.0–6.3. The step that CAN carry identity is `AddPaymentInfo`, now doing so | `bookingsystem@cad3bdf` | 2026-09-04 |
| TRK-02 | No `event_source_url` on any `bookingsystem` server event. Meta flags it: miami 90% of events / 4 ad sets (detected 08-22), dtown 57% / 1 ad set (detected 08-18) | **closed** — all three server events now send it, each from a source validated for that event | `bookingsystem@5f9cfe5` | 2026-09-04 |
| TRK-03 | No `content_ids` on the server Purchase, though mid-funnel has them and `items` is in scope | **closed** — server Purchase now sends `content_type`/`content_ids`/`num_items` | `bookingsystem@5f9cfe5` | 2026-09-04 |
| TRK-04 | Mid-funnel and Lead responses never inspected (bare `await fetch`) — an expired token fails silently on two of three paths | **closed** — all three paths go through one `postToMetaCapi()` that logs rejections and the accepted-but-0-received case | `bookingsystem@5f9cfe5` | 2026-09-04 |
| TRK-05 | Dallas GA4 cross-domain linker missing | **closed** — `gtag('set','linker',…)` + `allow_linker` added, matching Miami/Houston | `dtown@9d7687e` | 2026-09-04 |
| TRK-06 | **No repo sets `allow_linker`** — Miami's and Houston's linker has no receiver, so cross-domain stitching is broken everywhere, not just Dallas | **closed** — booking app now sets `allow_linker: true` on both gtag configs, so the linker finally has a receiver | `bookingsystem@d6a9da2` | 2026-09-04 |
| TRK-07 | Dallas chatbot emits `https://www.dtownatvrentals.com/book`, which the decorator's `LINKER_DOMAIN` selector cannot match — costs first-touch and UTMs (not fbclid; the cookie carries) | **closed** — chatbot interpolates `BOOK_URL`, so it matches `LINKER_DOMAIN` by construction. Cost was first-touch + UTMs, not fbclid | `dtown@9d7687e` | 2026-09-04 |
| TRK-08 | Dallas `FALLBACK_ORIGIN = book.turbobookings.net` — never fires in production, but turns a missing env var into silent off-domain traffic instead of a loud failure | **closed** — fallback is now the branded on-domain origin plus a loud `console.error`; returning `null` would have broken booking here | `dtown@9d7687e` | 2026-09-04 |
| TRK-09 | `tb_aid` cookie set without a domain, and never appended to any booking URL — so it has no producer | **closed** — cookie widened with `cookieDomainFor()`, and all three decorators now forward `tb_aid` | `bookingsystem@d6a9da2`, `dtown@9d7687e`, `takeovers-site@74ed13c`, `htown@f96d576` | 2026-09-04 |
| TRK-10 | `ga_client_id` / `ga_session_id` appended by the decorator, never read by the booking app | **closed** — proxy promotes `ga_client_id` to a cookie (only when no real `_ga`), checkout stashes it, commit falls back to it | `bookingsystem@d6a9da2` | 2026-09-04 |
| TRK-11 | Graph API version drift — `bookingsystem` v19.0, marketing sites v21.0 | **closed** — single `GRAPH_API_VERSION = v21.0`, matching the marketing sites | `bookingsystem@5f9cfe5` | 2026-09-04 |
| TRK-12 | A plain fork ships Miami's LIVE pixel, GA4 property and Ads account | **closed** — `lint:brand` now bans all five live Miami tracking IDs, so it is caught regardless of which fork flags were passed | `takeovers-site@9e9667a` | 2026-09-04 |
| TRK-13 | Template redirect `MAPPINGS` not host-constrained — a fork 301s its own pages to Miami | **closed** — `NEW_BASE` now derives from `siteConfig.domain.canonical`, and `lint:brand`'s `\btakeoversmiami\b` was widened (the word boundary never matched inside `takeoversmiamiatvrentals`) | `takeovers-site@9e9667a` | 2026-09-04 |
| TRK-14 | Low `fbp` coverage through CAPI (Meta's own diagnostic) | **blocked on measurement** — TRK-09 (the `tb_aid` scoping this was suspected to depend on) shipped 2026-09-04. Re-read Meta's action card 7–14 days after deploy before adding anything: it may already be closed | | |
| TRK-15 | Meta asks for Email on `ViewContent`/`AddToCart` | **closed as far as it honestly can be** — those steps have no email to send. Delivered where identity exists: `AddPaymentInfo` now mirrors server-side with `em`/`ph`/`fn`/`ln` and an `eventID` (it previously had neither) | `bookingsystem@cad3bdf` | 2026-09-04 |
| TRK-16 | Dallas domain verification outstanding since 2026-06-04 — `dtownatvrentals.com` unconfirmed in Business Settings | **won't do** — operator confirmed 2026-09-04 the domain no longer needs verifying; do not re-raise it | n/a | 2026-09-04 |
| TRK-17 | Miami's `AddPaymentInfo` is Pixel-only with no EMQ score where both forks show 9.3 | **not a code defect** — `AddPaymentInfo` exists only in `bookingsystem` and fires identically for all three markets; there is no Miami-specific divergence to fix. Most likely Meta's volume threshold at 371 events. Recorded so it is not re-chased | n/a | 2026-09-04 |
| TRK-18 | Miami fires zero `Lead` events; not one Miami row ever reached `leads` | **closed** — `siteConfig.customBooking` was never set after the 2026-08-21 cutover, so `EmailPopup` returned on its first line (`if (!cb) return`). The popup was enabled with full copy authored the whole time. Scope was the popup alone: `BOOKING_ORIGIN`/`BOOKING_SLUG` prefer env vars, and the live site already emitted `/miami` on all 15 CTAs | `takeovers-site@3780552` | 2026-09-04 |
| TRK-19 | `AddToCart` fired below `InitiateCheckout` in all three markets | **closed** — `trackAddToCart` sat inside `selectSlot` behind `totalQty > 0`, but every quantity starts at 0 and the widget reads date → time → riders, so the cart was always empty at slot-selection and the event never fired. Now fires from an effect when a cart actually forms, keyed on slot id so quantity changes don't inflate it | `bookingsystem@cad3bdf` | 2026-09-04 |
| TRK-20 | Miami — the template every fork is built from — scored below both forks on every shared event | **blocked on measurement** — two of its causes are now fixed (TRK-18: Miami fired no `Lead` at all; TRK-19: `AddToCart` barely fired anywhere). Re-read the EMQ table 7–14 days after deploy, post-2026-08-21 window only, before treating any residual gap as real | | |
| TRK-21 | Dallas emits an `__missing_event` (13 events, Pixel-only) | **open — low priority.** Meta's placeholder for an event arriving with no usable name. 13 events against 75K PageViews, Pixel-only so it is browser-side, and no `fbq` call in our code omits a name. Most likely an extension, a bot, or a stale cached bundle. Not worth chasing until it grows | | |
| TRK-22 | **Dallas's popup advertised `RIDE10` to 1,081 subscribers and the code did not exist.** Found while diagnosing TRK-18. `resolveDiscount` matches `upper(code)=upper(input)` scoped to the location, so every attempt returned "Code not found" — 18 days of an unredeemable offer on an operator client's site | **closed** — created `RIDE10` ($10.00, `order_total`, active) for dtown and miami; pointed Miami's popup at it and made its headline state the actual offer | `dashboard@6d8bf62` | 2026-09-04 |
| TRK-23 | **Houston had no email capture at all** — no `EmailPopup`, no `customBooking`, no `popup_config` row, where Miami and Dallas both had one | **closed** — component ported, layout wired, `customBooking` set, plus an htown `popup_config` row and matching `RIDE10` created together | `htown@1621ee1`, `dashboard@6a0b7d1` | 2026-09-04 |
| TRK-24 | **Every popup told subscribers to "check your inbox for the code" and no email is ever sent.** `api/leads` imports no mailer; the only templated email in the booking system is `reminder_24h`. The code is shown on screen, so they had it — and were sent looking for an email that never comes | **closed** — copy now reads "Here's your code — use it at checkout", rewritten only where the stale default was still in place | `dashboard@6a0b7d1` | 2026-09-04 |
| TRK-25 | **There is no email infrastructure for leads.** 1,081+ captured emails receive nothing — no welcome, no code delivery, no nurture. Scoped as its own phase after this build, per the operator | open | | |
| TRK-26 | Houston's live site renders Miami's brand colours (`#c8102e`, `#8a0a1e`, `#39ff14`); its own primary is `#d42427`. The fork's colour substitution was partial | **won't do** — operator decision 2026-09-04: the site has been live and working, a re-brand is not worth the churn. Recorded in `htown/brand-lint.json` with reasons, so the linter still catches anything NEW. `#d4a853` was a false positive — it is genuinely Houston's accent | `htown@2dbb287` | 2026-09-04 |

**Verification still owed on the 2026-09-04 batch.** TRK-02/03/04/11 are closed in code and pass
tsc, eslint, `next build` and both capacity suites — but the honest proof is Meta's own diagnostic.
7–14 days after deploy, re-read this table over a **post-2026-08-21 window only**, in this order of
confidence:

1. `s2s_missing_event_source_url_actions` clears on all three datasets — binary and unambiguous.
2. `InitiateCheckout` EMQ moves off ~6.1 toward Purchase's ~9.2 (that one needs TRK-01 too).
3. Affected ad spend falls from the $15,141 baseline.

If TRK-18 (Miami's missing `Lead`) is still silent after this deploy, that is now a *loud* silence —
TRK-04 means a failing Lead send finally logs.

**An advertised code must resolve.** `popup_config.incentive_code` is free text and nothing joined it
to `discount_codes` — which is how Dallas advertised a code that never existed for eighteen days. The
check is one query, and `scripts/create-popup-discount-codes.ts` runs it as a post-condition:

```sql
SELECT l.slug, p.incentive_code FROM popup_config p JOIN locations l ON l.id = p.location_id
WHERE p.enabled AND p.incentive_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM discount_codes d
                  WHERE d.location_id = p.location_id
                    AND upper(d.code) = upper(p.incentive_code) AND d.active);
```

It must return zero rows. Run it after any popup or discount change; it belongs in
`location-preflight` next.

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
