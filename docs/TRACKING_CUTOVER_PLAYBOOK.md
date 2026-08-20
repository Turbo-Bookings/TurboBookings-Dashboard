# Tracking cutover playbook — moving a location off FareHarbor

> Written 2026-08-20, after taking Dallas live and verifying it twice. Applies to
> **Houston next, then Miami.** Read this before touching any tracking config on a
> location that still runs FareHarbor.
>
> Companion docs: `POST_LAUNCH_TRACKING_DEEP_DIVE.md` (the Dallas verification
> results) and `BOOKING_SYSTEM_SPRINTS.md` (the roadmap).

---

## 0. The one thing that can actually hurt you

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

## 9. Per-location state (update as it changes)

| | Dallas | Houston | Miami |
|---|---|---|---|
| Booking system | ✅ live | catalog ready, not cut over | **nothing built** |
| Items / schedules | ✅ | 3 items ✅, schedules ✅ | 0 / 0 |
| Stripe Connect | ✅ | ✅ | ✅ |
| `tracking_config` row | ✅ | ❌ | ❌ |
| Meta pixel | `25974101692226269` | `1516241692811826` (hardcoded) | confirm |
| GA4 | none | `G-BQQMF72HGR` | confirm |
| Google Ads | none | `AW-10833387733` | confirm |
| Primary Ads conversion | n/a | GA4 purchase import | confirm |
| Marketing-site fixes §4 | ✅ | ❌ | ❌ |
| Readiness gate | open | **open** — storefront is live | closed (0 bookable items) |

Miami is a clean slate: zero items, zero bookings, no tracking row. Its booking
page is 404 because the gate requires at least one bookable, listed item — so
there is no rush and no exposure. Build the catalog first, tracking second.
