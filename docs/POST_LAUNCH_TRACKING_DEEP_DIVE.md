# Post-launch tracking & events deep dive

> Run **12–24 hours after the Dallas marketing site is live** on
> `dtownatvrentals.com`, once real traffic (and ideally a real ad click) has come
> through. Agreed 2026-08-18.
>
> Purpose: prove that every tracking and event path actually fires with correct
> data in production — not that it is *configured*, which is all we have
> established so far.

## Why this is separate from "verification passed"

The dashboard's `verifyTracking()` greps the live site's **server-rendered HTML**
for each configured ID. For Meta that match lands on the `<noscript>` fallback
tag, because the real `fbq()` init is injected client-side by
`<Script strategy="afterInteractive">` and is therefore absent from the SSR
output.

So a green verification proves **the pixel ID is present and correct**. It does
**not** prove a single event fired. Everything below is about the second claim.

---

## 1. Meta Events Manager — the primary check 🔴

Open Events Manager → the Dallas pixel (`25974101692226269`) → **Test events** and
**Events overview**.

| Check | What to look for |
|---|---|
| `PageView` firing | from `dtownatvrentals.com`, browser-side |
| `ViewContent` on a tour page | mid-funnel, feeds retargeting |
| `InitiateCheckout` | fires on the booking app, `book.dtownatvrentals.com` |
| **`Purchase` — value** | must read **$120** (booking subtotal), **NOT $28.60** |
| **`Purchase` — deduplication** | browser + server events must collapse into ONE, matched on `event_id` = `booking-<bookingId>` |
| Event Match Quality | check the score; low EMQ means `user_data` (email/phone/fbp/fbc) is not reaching CAPI |
| Domain / source | events attributed to the branded domain, not `book.turbobookings.net` |

**The Purchase value is the one that matters most.** Until 2026-08-18 both the
browser and server events sent `depositPaidCents` ($28.60 on a $120 tour), which
understated ROAS ~4.2×. Fixed in `7147b53` — both sides now send
`subtotal - discount`. **Confirm the fix in live data**, because historical
conversion values do not retroactively correct.

**Deduplication is the second-most important.** Both events carry the same
`event_id`. If Events Manager shows TWO Purchases per booking, dedup is broken
and every conversion is double-counted — which would look like the ROAS problem
inverted.

## 2. Ad-click attribution 🔴 — genuinely unproven

The live test booking (#0189) had `first_attribution_click_type` and
`first_attribution_click_id` **null**, because it came from a direct visit. The
gclid/fbclid capture path has therefore never been exercised end to end.

Verify with a **real ad click** (or a manual visit with `?fbclid=test123`):

```sql
select display_number, c.first_attribution_click_type, c.first_attribution_click_id
from bookings b join customers c on c.id = b.customer_id
join locations l on l.id = b.location_id
where l.slug = 'dtown' and b.external_ref is null
order by b.created_at desc limit 5;
```

Also confirm `_fbc` / `_fbp` cookies are set on the **registrable domain**
(`dtownatvrentals.com`), so they survive the hop from the marketing site to
`book.dtownatvrentals.com`. If they are scoped to the host instead, first-party
attribution silently dies at the domain boundary — the booking still completes,
revenue still lands, and Meta simply never learns which click caused it.

## 3. Server-side CAPI payload quality

`meta_capi_purchase_enabled` is `true` for Dallas and the `META_CAPI_TOKEN`
secret is stored. Confirm the server event carries:

- `event_id` matching the browser event (dedup)
- hashed `em` / `ph` from the customer record
- `fbp` / `fbc` forwarded from the browser (these come through the `capi` param
  on `afterBookingCreated`)
- `client_ip_address` / `client_user_agent`
- `value` = 120, `currency` = USD
- `contents` / item price consistent with `value` — these disagreed before the
  fix and would disagree again if only one side is changed

## 4. Google — expected to be absent, confirm deliberately

`ga4_measurement_id` and `google_ads_conversion_id` are both **null** for Dallas
(no accounts exist yet). Expect **no** Google tag on the site. The relevant
regression to watch for: `GoogleAnalytics.tsx` logs a loud console error in
production when both are unset — confirm that error appears in Vercel logs and
that nothing else silently half-loads. When the Ads account is created, set the
Ads ID **and** the purchase label, or the conversion tag loads and never fires.

## 5. The booking.created event pipe

17+ events are queued in `outbound_event_queue` with `attempt_count = 0` and
`last_error: REPLIT_WEBHOOK_URL or _SECRET not set`. This is expected — the
cockpit feed is deferred — but confirm new bookings keep enqueuing correctly and
the envelope stays well-formed (`subtotal`, `deposit_paid`, `balance_due`,
`platform_fee`, `stripe_payment_intent_id`).

Naming drift to watch: the dashboard reads `REPLIT_WEBHOOK_URL`; bookingsystem
reads `BRAIN_WEBHOOK_URL ?? REPLIT_WEBHOOK_URL`.

## 6. Email pipeline under real load

The first 354 imported-booking reminders begin sending. Run:

```
npm run emails:status -- dtown
```

Watch `sent` climbing, `errored` staying at 0, and nothing sitting past its send
time. Cross-check Resend for bounce/complaint rates — these 185 people booked via
FareHarbor and have never received mail from this sender.

---

## Related
- `docs/DALLAS_GO_LIVE.md` — the cutover runbook
- `docs/VERIFY_2026-08-19.md` — the day-after email + retainer checks
- `docs/EMAIL_DELIVERY_TRACKING.md` — why "sent" ≠ "delivered" today

---

# ✅ RESULTS — second pass, 2026-08-20 (3 days live, 62 real purchases)

Window: Aug 19–20 in Events Manager (America/New_York), i.e. entirely post-fix.

## Meta — all four health checks green

| Meta's own indicator | Result |
|---|---|
| Event coverage | ✅ Meeting best practices |
| **Event Match Quality** | ✅ **8.5 / 10** (was 6.3 pre-fix) |
| Event deduplication | ✅ Meeting best practices |
| Data freshness | ✅ Hourly |

**Deduplication is proven, not assumed.** Meta received **57 browser + 62 server**
Purchase events and reported **62 Purchases** — it collapsed 119 raw events into 62
on `event_id`. A broken dedup would have shown ~119. Cross-checked against our own
DB: 52 online bookings in the same window, and Meta's chart range bleeds into
Aug 18, which accounts for the difference. Ratio 1.19, nowhere near 2.0.

**Purchase value is fixed in live data.** Recent bookings send the full booking
value (e.g. $480 / $500 / $720) rather than the deposit ($114 / $94 / $171) —
the ~4.2× understatement is gone.

**Ad-click attribution is now PROVEN.** It was listed as "genuinely unproven"
because the only test booking came from a direct visit. **11 of 70 direct
bookings now carry `fbclid`.** The path works end to end.

**Cookie hop across the domain boundary verified by hand.** Loaded
`dtownatvrentals.com/?fbclid=verifypass20260820`, then `book.dtownatvrentals.com`:
both `_fbp` and `_fbc` survived, `_fbc` carrying the test click id. Cookies are on
the registrable domain, so attribution does not die at the subdomain hop.

## Two real findings

**1. Duplicate `_fbc` cookie on the marketing site.** `setCookie()` in
`src/lib/cookies.ts` sets no `domain` attribute, so our `captureFbclid` writes a
**host-scoped** `_fbc` on `www.` while Meta's pixel writes a **domain-scoped** one.
Both exist on the marketing site; only Meta's crosses to the booking subdomain
(which is why attribution still works). Harmless today, but a same-name cookie pair
means `getCookie("_fbc")` can read either one. Fix by setting the registrable
domain. **Applies to every fork, Houston included.**

**2. Meta's top match-quality recommendation: IPv6.** *"Your server is sending IPv4
IP addresses through Conversions API, but we observe IPv6 IP addresses received
through Meta Pixel."* We take the first `x-forwarded-for` entry
(`lib/actions/checkout.ts`), stash it in Stripe metadata at checkout, and replay it
at commit. Worth investigating whether Vercel is handing us an IPv4 address for a
client that reaches Meta over IPv6 — this may be network reality rather than a bug,
so measure before changing anything. Meta also suggests sending city / state / zip /
country, which we do not collect at checkout.

The "63% of Purchase events are receiving hashed customer info" line did NOT move.
Do not read that as the fix failing: EMQ moved 6.3 → 8.5, and all 52 customers in
the window have email, phone and first name on record (49 have last name), so the
data is present on our side. It is a browser-only rolling aggregate that still spans
pre-fix days. Re-check in a week rather than acting on it now.

## Google — confirmed absent for Dallas, as expected

`ga4_measurement_id` and `google_ads_conversion_id` are both still null. Nothing to
verify until an account exists.

## Event pipe — healthy, still parked

116 events queued, all `attempt_count = 0`, all with the expected
`REPLIT_WEBHOOK_URL or _SECRET not set`. Newest enqueued minutes ago, so bookings
keep queueing correctly. Deferred by choice, not broken.
