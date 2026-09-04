# Tracking cutover playbook — moving a location off FareHarbor

> Written 2026-08-20, after taking Dallas live and verifying it twice. Applies to
> **Houston next, then Miami.** Read this before touching any tracking config on a
> location that still runs FareHarbor.
>
> Companion docs: `POST_LAUNCH_TRACKING_DEEP_DIVE.md` (the Dallas verification
> results) and `BOOKING_SYSTEM_SPRINTS.md` (the roadmap).

---

## 0. The one thing that can actually hurt you

> ✅ **DONE 2026-08-31 — this section describes the world BEFORE the switch.** Houston and Miami now
> both run `Purchase - Booking System` as the primary Google Ads conversion (`primary=True`,
> `in_conversions_metric=True`); the GA4 import was demoted to secondary on both. Applied atomically
> per account via `mutate_conversion_actions`; all 11 enabled campaigns verified on the account-default
> `PURCHASE/WEBSITE` goal. Expect **~15% more reported conversion value with no real change in
> bookings** — accounting, not performance. It moves Houston's efficiency-derived tROAS floor
> ~402% → ~458%. **Review 2026-09-14.** Canonical record: `docs/TRACKING.md`.

**Houston and Miami both import the GA4 `purchase` as the PRIMARY Google Ads
conversion.** Smart Bidding optimises against it.

That means the cutover risk is not "tracking breaks" — it is "**the primary
conversion goes to zero and Smart Bidding flies blind**". Everything below is
sequenced around keeping that one number continuous.

Dallas did not have this problem: it had no Google Ads account at all, so its
cutover was a clean-slate build. **Do not assume Houston and Miami are like
Dallas.** They are live, mature ad accounts with bidding history.

---

## 1. How the FareHarbor-era stack actually works

Corrected 2026-08-20 — an earlier reading of `google-tracking.ts` had this wrong.

```
FareHarbor booking
   ├─ FareHarbor's OWN native GA4 integration  →  GA4 purchase  →  imported as
   │    (client-side, transaction_id = booking.pk)   PRIMARY Google Ads conversion
   │
   └─ our webhook  /api/webhooks/fareharbor      →  Meta CAPI Purchase
        (in the MARKETING SITE repo, not ours)   →  GA4 MP purchase ❌ DISABLED
```

The GA4 Measurement Protocol arm of our webhook is **switched off in production**
on both Houston and Miami, and has been since 2026-06-09. See §2.

So today, on a FareHarbor location:

| Signal | Source | Live? |
|---|---|---|
| GA4 `purchase` | FareHarbor's native GA4 integration | ✅ **this is what feeds Ads bidding** |
| Google Ads conversion | GA4 import of the above | ✅ Primary |
| Meta Purchase (CAPI) | our `/api/webhooks/fareharbor` | ✅ |
| Meta Purchase (browser) | site pixel | ✅ |
| GA4 `purchase` from our MP | our webhook | ❌ deliberately disabled |

---

## 2. INCIDENT 2026-06-09 — the GA4 double-count, and the rule it leaves behind

Both Miami and Houston inflated GA4 purchases ~**1.81×** for about 35 days.

**Cause:** our server-side GA4 MP fire used `booking.uuid` as `transaction_id`
while FareHarbor's native GA4 integration used `booking.pk` for the same booking.
Different IDs → GA4 never deduplicated → two purchases per booking. Houston imports
GA4 purchase as its **Primary** Ads conversion, so Smart Bidding optimised on
inflated numbers for over a month.

**Fix applied:** `vercel env rm GA4_MP_API_SECRET production` **plus a redeploy**
(the removal is inert until you redeploy) on both locations. Our MP arm went
silent; FareHarbor's well-attributed client-side purchase remained.

### The rule

> **Two systems must never both send `purchase` into the same GA4 property unless
> they agree on `transaction_id`.** GA4 deduplicates on that field and nothing
> else. There is no error, no warning — just a number that is quietly too big, and
> a bidding algorithm that believes it.

This is *exactly* the failure mode our Meta setup avoids by construction, because
browser and server both send `event_id = booking-<uuid>`. GA4 gets the same
treatment from our booking system — but FareHarbor is a third party we cannot make
agree with us. Hence: **never run both at once.**

**Do not re-add `GA4_MP_API_SECRET` to a marketing site's Vercel env.** If you ever
need our webhook's MP arm back, it must first be changed to send
`transaction_id = booking.pk` and validated with a test booking.

Note the storage split, which is easy to confuse:

- **`GA4_MP_API_SECRET` in the marketing site's Vercel env** → the FareHarbor-era
  webhook. Removed. Leave it removed.
- **`GA4_MP_API_SECRET` in our `location_secrets` table** → our booking system's
  own MP fire. This is a *different secret in a different place* and is the one you
  DO set at cutover.

---

## 3. What keeps Google Ads bidding alive through the cutover

Our booking system fires GA4 `purchase` into whatever `ga4_measurement_id` is set
on the location. **Point it at the same GA4 property the site already uses** and
the conversion never breaks:

- Houston: `G-BQQMF72HGR`
- Miami: confirm before cutover

Then the sequence is safe because the two sources never overlap:

1. Site CTAs still point at FareHarbor → FareHarbor's GA4 purchase fires. Ours does
   not, because no bookings exist in our system yet.
2. You repoint the CTAs. New bookings go to our system → **our** GA4 purchase fires.
   FareHarbor gets no new bookings, so its purchase stops on its own.
3. GA4 sees one continuous stream of `purchase` events in the same property. The
   Ads import keeps working. **No Ads-side edit is required, and none should be
   made during the cutover week.**

### Rules for the Ads account

- **Do not change the Primary conversion during cutover.** Continuity comes from
  the GA4 property, not from a new conversion action.
- If you later want a discrete Ads conversion action, create it as **Secondary**,
  let it gather 2+ weeks and 30+ conversions, then promote it.
- Promote by flipping new→Primary and old→Secondary **in the same edit**. Never
  leave the account with zero primary conversions, even briefly.
- **Change one thing at a time.** Never move the primary conversion and the bidding
  strategy in the same week — if performance shifts you will not know which did it.
- Allow ~2 weeks of re-learning before judging performance.

---

## 4. Per-fork marketing-site fixes (required BEFORE repointing CTAs)

Every fork predates the Dallas fixes and needs these. Dallas already has them;
Houston and Miami do not.

1. **`trackBookClick` must fire a custom `BookClick`, not `InitiateCheckout`.**
   Our booking app fires the real InitiateCheckout at its checkout step. Leave the
   site as-is and every funnel gets two per customer. **This is the one that
   silently corrupts data the moment you cut over.**
2. **Cross-domain linker** — `gtag('set','linker',{domains:['fareharbor.com']})`
   must point at the new booking origin, or GA sessions split at the handoff.
3. **Google tag bail-out** — the fork returns null unless GA4 is set, which kills
   the Ads tag on any location with an Ads ID but no GA4 property.
4. **Hardcoded tracking IDs** → env vars, matching Dallas. Houston currently
   hardcodes pixel `1516241692811826`, GA4 `G-BQQMF72HGR`, Ads `AW-10833387733`.
5. ~~`_fbc` cookie scope~~ — **fixed 2026-08-20** in the template and both forks.

---

## 5. The verified baseline (what "working" looks like)

Measured on Dallas over Aug 19–20, 62 real purchases, entirely post-fix:

| Check | Target |
|---|---|
| Event coverage | Meeting best practices |
| **Event Match Quality** | **8.5 / 10** |
| Event deduplication | Meeting best practices |
| Data freshness | Hourly |
| Browser vs server vs reported | 57 + 62 raw → **62 reported** (collapsed on `event_id`) |
| Purchase value | full booking value, **not** the deposit |
| `fbclid` capture | 11 of 70 direct bookings |
| `_fbp`/`_fbc` across the subdomain hop | both survive |

Use the dedup arithmetic as the acceptance test on every location: **browser +
server raw counts should collapse to roughly the browser-or-server maximum, not
their sum.** If reported ≈ browser + server, dedup is broken.

---

## 6. Two CAPI bugs found chasing match quality — fixed 2026-08-20

Both were silent. Both are shared code, so every location inherits the fix.

1. **Phone hashes never matched.** We hashed E.164 (`"+12145143565"`) while the
   browser pixel hashes digits only (`"12145143565"`). Different digest → no match
   → **every server-side Purchase ran without the phone signal since CAPI went
   live.** Replaced the single generic `hash()` with per-field normalisers, because
   one shared helper is what let the phone rule go missing.
2. **`fn` / `ln` were never sent server-side**, though the browser sent them and
   the same customer record held them. Added, plus `country`.

**Lesson worth keeping:** a wrong hash is indistinguishable from a missing user.
Meta reports no error. The only way to catch it is to normalise both sides with
the same rule and assert they produce the same digest.

---

## 7. IPv6 — closed, not fixable

Meta's top match-quality action reads *"Your server is sending IPv4 IP addresses
through Conversions API, but we observe IPv6 IP addresses received through Meta
Pixel."*

**Vercel publishes no AAAA records anywhere — including `vercel.com` itself.** A
dual-stack visitor reaches `connect.facebook.net` over IPv6 and reaches us over
IPv4. Both addresses are genuinely theirs; there is no IPv6 address on our side to
send. No code change resolves this.

Do not proxy through another CDN to chase one matching signal. Re-test with
`dig AAAA <host>` if Vercel ever ships it.

---

## 8. Ordered cutover sequence

🤖 = code/config I can do · 🧑 = needs your account access or an operator decision

**Phase A — shared code (safe, changes nothing live)**
1. 🤖 Marketing-site fixes §4 items 1–4, on `develop`.
2. 🤖 Build the catalog: items, customer types, resources, pricing, resource
   requirements. Verify the storefront renders and capacity enforces.
3. 🧑 Create availability schedules.

**Phase B — configure, do not switch**
4. 🧑 Confirm which GA4 property and which Ads conversion action is Primary.
5. 🤖 Create the `tracking_config` row: pixel, **the same GA4 measurement ID the
   site already uses**, Ads conversion ID + purchase label, CAPI enabled.
6. 🧑 Store `META_CAPI_TOKEN` and `GA4_MP_API_SECRET` in `location_secrets` (our
   table — *not* the site's Vercel env; see §2).
7. 🤖 Import FareHarbor bookings (`npm run import:fh`, `--allow-overbook` if the
   fleet has shrunk). Idempotent; re-run freely.

**Phase C — cut over**
8. 🧑 Merge the site fixes to `main`.
9. 🧑 Repoint the site's booking CTAs at the booking origin.
10. FareHarbor's webhook and native GA4 fire go quiet on their own — no new
    FareHarbor bookings. **No double-count window, provided §4.1 shipped.**

**Phase D — verify within 24h, then again at 1 week**
11. 🤖 Events Manager against the §5 table: EMQ, dedup arithmetic, Purchase value.
12. 🤖 `select ... first_attribution_click_type` — confirm `fbclid` is landing.
13. 🧑 GA4: confirm `purchase` volume is continuous across the cutover date, with no
    step-change up (double-count) or down (dropped conversion).
14. 🧑 **Only now** consider any Google Ads conversion or bidding change.

---

---

## 9. Houston progress log

### Done — Phase 1 (on `develop`, NOT deployed)

The cutover is now **one environment variable** on the Houston site:
`NEXT_PUBLIC_BOOKING_ORIGIN`. Unset, nothing changes (verified by building both
ways and diffing the output). Set, these flip together and cannot drift apart:

- Book CTAs → our booking app, deep-linked per tour
- GA cross-domain linker → the booking host instead of `fareharbor.com`
- Book click → custom `BookClick` instead of `InitiateCheckout`
- FareHarbor lightframe → stops loading
- AI chatbot → hands out the new booking links

Unsetting it is an instant rollback. Also fixed the Google-tag bail-out and moved
the hardcoded pixel / GA4 / Ads ids to env vars (literals kept as fallbacks — on a
live site a missing env var must not mean no tracking at all).

**Two cutover surfaces the plan had missed**, found by grepping the built output
for surviving `fareharbor.com` references rather than by re-reading the code:
the **chatbot's knowledge base** hardcoded FareHarbor booking links (it would have
kept sending customers to the old system after cutover), and FareHarbor's
**lightframe** would have kept intercepting clicks in the capture phase. Both now
follow the switch. **Do this grep on Miami too** — it is a better check than
reading the diff.

> ⚠️ **Corrected 2026-08-28. This paragraph used to say the decorator "matches nothing and goes
> inert" once the booking app is on our own domain. That is FALSE and acting on it would delete live
> attribution.**
>
> `LINKER_DOMAIN` is derived from `BOOKING_ORIGIN`, so after a cutover the decorator matches
> `book.<domain>` links and keeps decorating them. It was briefly true only while the host was pinned
> to a `fareharbor.com` literal — Houston shipped that way and ran blind for a day (`db51288`).
>
> It is now the **primary** capture path, not a fallback: the booking app reads click ids off the URL
> first (`clickFromUrl`) and treats `_fbc` / `_gcl_aw` as the legacy fallback, precisely because those
> cookies only exist if the Meta pixel and gtag both loaded and survived ITP.
>
> Dallas never had a decorator, which is why it forwarded nothing and could never capture a `gclid` at
> all. It was ported in on 2026-08-28, minus the FareHarbor-only session bridge.

### Done — Phase 2 (config)

- `tracking_config` row created for `htown`: mode `direct`, pixel
  `1516241692811826`, GA4 `G-BQQMF72HGR`, Ads `AW-10833387733`, CAPI enabled.
- **`google_ads_purchase_label` left NULL on purpose.** `adsSendTo` requires BOTH
  the conversion id and a label, so with no label our booking app fires no direct
  Ads conversion — which is what we want, because Ads already gets its conversion
  from the GA4 import. Setting a label here would create a SECOND Ads conversion
  for the same booking. The conversion id alone still loads gtag and builds
  remarketing audiences, which is why it is set.
- `book.htownatvrentals.org` added to the `bookingsystem` Vercel project.
  Ownership verified; inert until DNS points at it.

### Cutover rehearsed on a preview — 2026-08-20

`NEXT_PUBLIC_BOOKING_ORIGIN` is set on the **Preview scope only**, so every
`develop` build deploys in the post-cutover state while production stays on
FareHarbor. Both were then measured in a live browser, same page, same moment:

| | Preview (switch ON) | Production (switch OFF) |
|---|---|---|
| Book CTAs | 4 → `book.htownatvrentals.org`, deep-linked per tour | FareHarbor embed |
| FareHarbor CTAs left | **0** | 4 |
| Meta event on Book click | **`trackCustom BookClick`** | `track InitiateCheckout` |
| GA event on Book click | `book_click` | GA InitiateCheckout |
| GA linker domain | `book.htownatvrentals.org` | `fareharbor.com` |
| FareHarbor lightframe | not loaded | loaded |
| Pixel / GA4 / Ads ids | `1516241692811826` / `G-BQQMF72HGR` / `AW-10833387733` | same |

The InitiateCheckout double-count is therefore fixed **and proven at runtime**,
not just in the diff — and production is provably unchanged.

**Keep this preview variable in place.** It means any future `develop` build is a
free rehearsal, and it makes the production flip a variable copy rather than a
first attempt.

**Rehearsal gotcha:** the first preview I tested was built minutes BEFORE the env
var existed, so it looked unflipped and suggested the switch was broken. Vercel
bakes `NEXT_PUBLIC_*` at build time — always confirm the deployment's created
timestamp is later than the variable's before concluding anything.

### GA4 property audit — 2026-08-20

Property *Texas ATV Rentals*, stream **H-Town ATVs Website** (`G-BQQMF72HGR`,
`GT-5RMZMWPX`).

- **Measurement Protocol API secret** — Admin → Data streams → the stream →
  *Measurement Protocol API secrets*. Nickname "Website API", created 2026-05-05.
  This is what `GA4_MP_API_SECRET` means. It is NOT the Google Ads token.
- **Cross-domain linking** is `Contains htownatvrentals.org` + `Contains
  fareharbor.com`. The first **already covers `book.htownatvrentals.org`**, so
  our booking subdomain needs no change — GA4 treats it as the same site and
  there is no self-referral to exclude.
- **The only GA4 cleanup at cutover: remove `fareharbor.com`** from that list.
  Not before — the linker is load-bearing while FareHarbor is live.
- **Tag quality "Needs Attention" is entirely FareHarbor noise.** The 3 untagged
  pages are FareHarbor's own operator dashboard URLs
  (`fareharbor.com/htownatvrentals/dashboard/…`), which only appear because
  fareharbor.com is in cross-domain config and can never be tagged by us.
  Removing fareharbor.com clears this too.
- **Do NOT "Accept suggestion"** on the suggested domains. They are Vercel
  preview hosts (`*.vercel.app`, including my rehearsal deploys) and
  `dtownatvrentals.com`. Verified Dallas is NOT polluting this property: its
  `GA_MEASUREMENT_ID` and `GOOGLE_ADS_ID` both default to `""`, are unset in
  Vercel, and the live Dallas site loads no Google tag at all. The suggestion is
  historical, from before the Dallas fork was cleaned up.

### ⚠ BEFORE ANY CUTOVER: grep the fork for `fareharbor.com`

Added 2026-08-21 after finding this live on Houston a day after its cutover.

Anything in a marketing site that names `fareharbor.com` in a **guard or a
selector** is a cutover landmine. It keeps working right up until the day it
matters, then fails **silently** — nothing errors, nothing alerts, the page
looks fine.

```
grep -rn "fareharbor" src/ | grep -v "config/site.ts\|booking-origin"
```

Every hit should read from `LINKER_DOMAIN` / `ON_CUSTOM_BOOKING` instead of the
literal. Known instances, all now fixed:

| Where | Was | Failure mode after cutover |
|---|---|---|
| `GoogleAnalytics.tsx` | `linker: {domains:['fareharbor.com']}` | session splits at the handoff |
| `BookingLinkDecorator.tsx` | `a[href*="fareharbor.com"]` | selects zero anchors |
| `ad-tracking.ts` | `if (!href.includes("fareharbor.com")) return` | decorates nothing |
| `tracking.ts` | fires `InitiateCheckout` on CTA click | double-counts against the booking app's real one |

The first three cost the click-id **fallback** path, not attribution itself —
the booking app reads `_fbc` / `_gcl_aw` directly off the shared registrable
domain. The fourth is the one that actively corrupts data, by inflating the
exact funnel step Smart Bidding optimises against.

`dtown-atv-rentals-site` has none of these files; its fork is slimmer. Do not
assume every fork has the same surface — check.

### Miami — Google Ads DONE 2026-08-21

Account **Take over rentals `177-042-1744`**. Same shape as Houston, with the
differences that actually matter recorded below.

Created `Purchase - Booking System`:

| | |
|---|---|
| Data source | `book.takeoversmiamiatvrentals.com/miami` via Google tag `AW-10789560857` — Google's own scan reported **"Installed on site"**, which is the cheapest proof the booking app is tagged on the branded host |
| Event | Manual event, page load |
| Action optimization | **Secondary** — it defaults to PRIMARY in the wizard; switch it before saving or an untested action goes straight into Smart Bidding |
| Value | Different values per conversion, via Event snippet |
| Count / window | Every / 90 days — matches the GA4 Purchase action |
| Attribution / EC | Data-driven · enhanced conversions via Google Tag |
| **Label** | **`jpTBCNiXqeUcEJnE7pgo`** → `tracking_config.google_ads_purchase_label` |

**The label was changed, not just added.** It previously pointed at
`Online Booking Purchase` (`8xDPCPeauKQcEJnE7pgo`) — the action the marketing
site's FareHarbor webhook feeds. That action **dies at cutover**, so aiming the
booking app at it would have been a signal that silently stopped.

**Do NOT delete `Online Booking Purchase` before cutover.** It reads 0.00 over
30 days but **1.00 over 7 days** — `takeovers-site/src/app/api/webhooks/fareharbor/route.ts`
is actively firing into it. It is removable only once Miami is off FareHarbor.

Demoted `Book Tour Click` (Begin checkout) **Primary → Secondary** — ~963
conversions / 30 days out of bidding. Removed `Purchases Dynamic Value`
(Misconfigured, Secondary, 0 conversions).

**What could NOT be demoted, and why it is not a UI problem.** Google owns these
and exposes no per-action optimization control — the settings row has no expander
and no radios at all:

- `Store visits` — generated from Google's location data
- `Calls from Smart Campaign Ads`, `Smart campaign map clicks to call`,
  `Smart campaign ad clicks to call`, `Business profile - Call` — all 🔒, and
  three are **Misconfigured while Primary**, feeding bidding with actions that
  are not tracking. No Smart Campaigns are running (confirmed 2026-08-21), so
  they are orphaned.

The account-level Conversions → Settings page does not expose goal selection
either (only call action, lapse window, data terms, enhanced conversions,
engaged-view, app attribution). **The remaining lever is per-campaign: Campaign →
Settings → Conversion goals**, which overrides account defaults and bypasses the
lock. Not done — it changes what live, spending campaigns optimise for.

Bidding never lost a primary at any point: `takeoversrentals.com - GA4 (web)
purchase` stayed Primary throughout (53 purchases / $13.8K, last 7 days).

### Google Ads — Step 1 DONE 2026-08-20

Created `Purchase - Booking System` in account `631-129-2539`:

| | |
|---|---|
| Data source | H-Town ATVs Website (`AW-10833387733`) — Google tag, manual event |
| Action optimization | **Secondary** (reports fully, does NOT feed bidding) |
| Value | Use different values, via Event snippet |
| Count / click window | Every / 90 days — matches `GA4 Purchase` |
| Attribution | Data-driven |
| Enhanced conversions | **Enabled** |
| Conversion label | `lJydCJiOk-UcENXB4a0o` |

`tracking_config.google_ads_purchase_label` is set, so the booking app now builds
`send_to: AW-10833387733/lJydCJiOk-UcENXB4a0o`. Dallas is unaffected — it has no
Ads id, so `adsSendTo` stays null there.

End state, verified in the conversion actions table:

| Action | Source | Status | Optimization | Conv. |
|---|---|---|---|---|
| `GA4 Purchase` | Google Analytics (GA4) | Active | **Primary** | 581.60 |
| `Purchase - Booking System` | Website | Inactive | **Secondary** | 0.00 |

"Inactive" is correct and expected: the action fires only once bookings run
through our system, i.e. after cutover. Bidding is untouched.

**A Secondary action still collects and reports everything** — it is excluded
from the "Conversions" column that bidding reads, but appears under "All
conversions" and can be segmented by conversion action. That is what makes the
Step 2 reconciliation possible at zero risk.

**Two account fixes found along the way:**

1. **The website data source was stale.** It pointed at `book.peek.com` (a
   booking platform they trialled and dropped) with the Google tag reading *"Not
   installed yet"* — so the only working source was the GA4 import. That is the
   real reason bidding ended up on GA4. Re-scanned against
   `www.htownatvrentals.org`; the tag now reports **installed on site**.
2. `book.peek.com` remains registered in the account. Harmless, but worth
   removing on a tidy-up pass.

### Houston tracking readiness — 11/11 as of 2026-08-20

| | |
|---|---|
| Catalog — bookable tours | 3/3 |
| Availability schedules | 3/3 |
| Future slots materialized | 14,050 |
| Stripe Connect | connected |
| Meta pixel | `1516241692811826` |
| Meta CAPI enabled | true |
| `META_CAPI_TOKEN` | stored, decrypts |
| GA4 measurement id | `G-BQQMF72HGR` |
| `GA4_MP_API_SECRET` | stored, decrypts |
| Google Ads conversion id | `AW-10833387733` |
| Google Ads purchase label | `lJydCJiOk-UcENXB4a0o` |

Both secrets were verified by decrypting them through the same AES-256-GCM path
`bookingsystem` uses — not merely "the form said saved". The check also asserts
no leading/trailing whitespace, because a stray space from a paste produces a
credential that looks correct in the UI and fails every API call silently.

### What remains before cutover

1. ~~Merge `htown-atv-rentals-site` `develop` → `main`~~ — **DONE 2026-08-20**
   (`982c3a2`). Phase 1 is in production with the switch OFF, and production was
   re-measured after the deploy to prove nothing moved: 15 FareHarbor CTAs, 0
   booking-app CTAs, linker still on `fareharbor.com`, lightframe still loading,
   Book click still firing `track InitiateCheckout`. Cutover day is now one
   environment variable and one CSV.
2. ~~Import the FareHarbor CSV~~ — **DONE 2026-08-20**: 303 bookings, $73,587.23
   of value, $59,967.23 due at venue. Zero duplicates; a re-run is a clean no-op.
   Only the CSV's own "3 items" footer row was rejected.

   | Tour | Bookings | Units | Value |
   |---|---|---|---|
   | 1-Hour ATV Tour | 184 | 381 | $44,301.21 |
   | Night ATV Glow Tour | 116 | 244 | $27,932.91 |
   | Four Seater Buggy Tour | 3 | 3 | $1,353.11 |

   Needed a new `--map-item` flag: Houston's export calls it *"H-Town 1 Hour ATV
   Tour"* where we call it *"1-Hour ATV Tour"*, which left 184 of 303 rows
   `unmapped_item`. **Miami will need the same** — check the tour names in its
   export against ours BEFORE importing, not after.

   Capacity is comfortable: busiest slot is 32 of 65 ATVs, nothing over.

   ⚠️ **Buggy pricing is worth a look.** The three imported buggy bookings show
   subtotals of $390 and $430, not the $350 in our catalog. Totals were preserved
   via `subtotal_cents_override`, so the money is right and nothing is broken —
   but either the buggy is genuinely priced above $350 in FareHarbor, or those
   bookings carried add-ons. Worth confirming before the storefront sells it at
   $350.
3. Set `NEXT_PUBLIC_BOOKING_ORIGIN=https://book.htownatvrentals.org` on the
   **Production** scope and redeploy. That is the cutover.
4. Remove `fareharbor.com` from GA4 cross-domain linking (§9), after the flip.

### Blocked / needs a person

1. **Secrets.** `META_CAPI_TOKEN` and `GA4_MP_API_SECRET` must exist in
   `location_secrets` for `htown` — our booking app reads them from there, NOT
   from the marketing site's Vercel env. Enter them via the dashboard's
   **Integrations** page for the location, which is the intended write surface
   (it encrypts and writes an audit-log entry).
   **Without `GA4_MP_API_SECRET` the server-side GA4 purchase never fires**, and
   we lose the redundancy that catches ad-blocked visitors. The browser-side GA4
   purchase still fires from the measurement id alone.
2. **DNS.** One record at GoDaddy on `htownatvrentals.org`:

   | Type | Name | Value | TTL |
   |---|---|---|---|
   | CNAME | `book` | `d9c044261913766c.vercel-dns-016.com` | 600 |

   Same target Dallas uses — it is project-scoped, not per-domain. Verify before
   flipping the switch: `curl -sI https://book.htownatvrentals.org/htown | head -1`
3. ~~Which Google Ads conversion action is Primary~~ — **CONFIRMED 2026-08-20.**
   Account `631-129-2539` (H-Town ATV Rentals), goal *Purchases (Account-default
   goal)*, conversion action **`GA4 Purchase`**, source **Website (Google
   Analytics (GA4))**, optimization **Primary**, count Every, 90-day click
   window, included in account-level goals, 581.60 conversions Jul 19 – Aug 15.
   Every other action in the account shows "No recent conversions".

   So §3 holds exactly as written: bidding rides on the GA4 import, and pointing
   our booking system at `G-BQQMF72HGR` keeps that number continuous through the
   cutover with **no Ads-side edit at all**.

---

---

## 10. Migrating Google Ads bidding off the GA4 import

> ✅ **EXECUTED 2026-08-31 — Steps 1–3 are DONE.** Read this section as a record, not a to-do. Houston
> and Miami both now run `Purchase - Booking System` as primary with the GA4 import demoted to
> secondary. Step 4 (server-side conversion uploads) is the only part still outstanding.
> Anyone re-deriving this plan is re-doing finished work — check `docs/TRACKING.md` first.
>
> Two Miami leftovers from the switch, both harmless but worth a decision: a third dormant
> `Online Booking Purchase` action (30-day window) left secondary, and `Store visits` with
> `primary_for_goal=True` but `include_in_conversions_metric=False` (inert).

**Decided 2026-08-20.** The end state is direct Google Ads conversion tracking
with Enhanced Conversions, and eventually server-side uploads. The GA4 import is
the thing we are leaving, not the thing we are protecting long-term — §3 protects
it only so it can carry bidding safely THROUGH the cutover.

### Why direct beats the GA4 import

1. **Latency.** The import lags. Smart Bidding learns faster from a signal that
   arrives at conversion time.
2. **Stacked attribution.** GA4 attributes with its own model, then Ads
   re-attributes the imported conversion. Two models in series is noise, not
   precision.
3. **Loss.** A conversion that does not tie cleanly to a GA4 session can fail to
   import at all. Ads conversion tracking has no such dependency.
4. **Enhanced Conversions — the big one.** Hashed email/phone sent with the
   conversion recovers matches that cookie-only tracking loses to ITP and ad
   blockers. This is the same mechanism that moved Meta's EMQ from 6.3 to 8.5.

### Prerequisite — DONE 2026-08-20

The Ads conversion used to fire with `send_to` / `value` / `transaction_id` and
**no user data at all**. `setAdvancedMatching()` in
`bookingsystem/src/lib/tracking/events.ts` now also calls
`gtag('set','user_data', …)` alongside the Meta call.

Two traps, both encoded in that file:

- Values are **plaintext**. gtag normalises and hashes them itself; pre-hashing
  double-hashes and matches nothing.
- **Google wants E.164 WITH the `+`; Meta wants digits only.** Same number, two
  rules, and neither platform errors when it is wrong — exactly how our
  server-side Meta phone signal stayed broken for months.

Inert until a location has an Ads conversion configured, so it costs nothing to
ship early.

### Sequence

**Do NOT run this during a FareHarbor cutover.** Cut over first with the GA4
import still Primary so bidding never notices, let it settle, then migrate. Move
both at once and a performance change is unattributable.

**Step 1 — build it, Secondary.**
- Create an Ads conversion action, e.g. "Purchase — Booking System".
  Category *Purchase*, count *Every*, *Use different values for each conversion*,
  **Secondary** (i.e. not used for bidding).
- Copy its label into `tracking_config.google_ads_purchase_label` for the
  location. The conversion id is already set.
- Our booking app immediately starts firing it, with Enhanced Conversions, keyed
  on `transaction_id = booking-<uuid>` so Ads dedupes repeats within that action.
- Bidding is untouched: a Secondary action reports but does not optimise.

**Step 2 — reconcile against ground truth (2–4 weeks).**

This is the step most advertisers cannot do and we can: **our `bookings` table is
the truth.** For the same window, compare three numbers —

| Source | Where |
|---|---|
| Actual bookings + revenue | `bookings` in our DB |
| "Purchase — Booking System" | Google Ads, the new Secondary action |
| GA4-imported purchase | Google Ads, the current Primary |

Expect the direct action to sit closer to our DB than the import does. If it does
not, stop and find out why before promoting anything — a promotion built on a
worse signal is worse than the status quo.

**Step 3 — promote.**
- In ONE edit: new action → Primary, GA4 import → Secondary.
- **Never leave two Primary purchase actions.** They are separate conversion
  actions and do NOT dedupe against each other, so bidding would count every sale
  twice — the same failure as the 2026-06-09 incident, by a different route.
- Change nothing else that week. No bidding-strategy change, no budget step.
- Allow ~2 weeks of re-learning before judging performance.

**Step 4 — server-side uploads (the CAPI equivalent).**
Google Ads API `ClickConversion` upload using the stored `gclid` / `wbraid` /
`gbraid`, deduped by order id = booking id. Immune to ad blockers and ITP, and
the natural pair to Meta CAPI.

> ⚠️ **The existing `GOOGLE_ADS_CONVERSION_API_TOKEN` secret cannot work as
> designed.** Its placeholder is `ya29…`, an OAuth *access* token, which expires
> in about an hour. Server-side uploads need a **refresh token** plus client id,
> client secret, developer token and customer id. Rework that field when Step 4
> starts rather than storing something that expires the same afternoon.

### Rollback

Steps 1–2 are risk-free; a Secondary action changes no bidding. Step 3 rolls back
by reversing the same single edit. Only Step 4 involves new credentials.

---

## 11. Per-location state (update as it changes)

> ⚠️ **Rewritten 2026-09-04.** The previous version of this table described Miami as "nothing built",
> "0 items", "`tracking_config` ❌" and "booking page is 404". All four were true when written
> (2026-08-20) and all four are now false — Miami cut over on 2026-08-21 and took 160 online bookings
> in the week of 08-28 alone. A stale state table is worse than no state table; keep this one current
> or delete it.

| | Dallas | Houston | Miami |
|---|---|---|---|
| Booking system | ✅ live | ✅ live (cut over 2026-08-21) | ✅ live (cut over 2026-08-21) |
| Items / schedules | ✅ | ✅ | ✅ |
| Stripe Connect | ✅ | ✅ | ✅ |
| `tracking_config` row | ✅ | ✅ | ✅ |
| Meta pixel | `25974101692226269` | `1516241692811826` | `516637097197570` |
| GA4 | **none — intentional** | `G-BQQMF72HGR` | `G-W1737CSQ2C` |
| Google Ads | **none — intentional** | `AW-10833387733` | `AW-10789560857` |
| Primary Ads conversion | n/a | `Purchase - Booking System` ✅ switched 2026-08-31 | `Purchase - Booking System` ✅ switched 2026-08-31 |
| Booking origin | book.dtownatvrentals.com | book.htownatvrentals.org | book.takeoversmiamiatvrentals.com |
| Readiness gate | open | open | open |

**Dallas's "none" for GA4 and Google Ads is a decision, not an omission.** It runs Meta only; it has
no Google Ads account and has never recorded a `gclid`. See `docs/TRACKING.md`.

FareHarbor was retired as a booking surface on 2026-08-21 for all three markets.
