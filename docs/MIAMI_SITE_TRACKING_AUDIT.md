# Miami marketing-site tracking audit

> `~/takeovers-site`, audited 2026-08-21 against the question that actually
> matters: **what breaks the day Miami leaves FareHarbor, and what silently
> mis-reports before then.** Sources are the repo itself, not documentation.

## The blast radius is one file

`src/app/api/webhooks/fareharbor/route.ts` is the single most important file on
the site. On every FareHarbor booking it fires **four things at once**:

| It sends | Replaced after cutover by |
|---|---|
| GA4 Measurement Protocol `purchase` — with the visitor's **real** `client_id` + `session_id` via the intent store | booking app `sendGa4` (fixed 2026-08-21, see below) |
| Meta CAPI `Purchase`, `event_id` matched to FareHarbor's own CAPI so Meta dedupes across both senders | booking app `firePurchaseServerSide` |
| Google Ads — **logs a planned payload only** | nothing; unchanged (see below) |
| The cockpit / brains feed | **NOTHING YET** — needs `REPLIT_WEBHOOK_URL` |

That route stops firing the moment Book CTAs leave FareHarbor. Three of the four
now have replacements. **The cockpit feed does not** — see the queue note in
`BOOKING_SYSTEM_SPRINTS.md`.

`src/app/api/booking-intent/route.ts` and `src/lib/booking-intent-store.ts`
become redundant at the same moment: they exist only to bridge GA identity into
the FareHarbor webhook. The booking app needs no bridge because it shares the
registrable domain and reads the cookies directly.

## Fixed during this audit

**The cutover switch was only half wired.** `booking-origin.ts` had been ported
but only `booking.ts` used it, leaving every tracking decision pinned to
FareHarbor. Three bugs, all of which would have fired on cutover day:

- the GA linker still stitched to `fareharbor.com`, splitting the session at the
  handoff
- `BookingLinkDecorator` selected `a[href*="fareharbor.com"]`, so it would have
  decorated **nothing** — gclid/fbclid captured on the site and then never
  forwarded into the booking flow
- `trackBookClick` fired `InitiateCheckout` on the CTA click, which would
  double-count against the booking app's real one and inflate the exact step
  Smart Bidding optimises on. It now reports `BookClick` once on our own system.

**GA4's server-side Purchase had a synthetic `client_id`** (booking app, affects
all three locations). Detail in that commit; short version: it only bit when the
browser event was blocked, which is the one case server-side tracking exists for,
so the least attributable bookings were attributed worst. Now reads `_ga` /
`_ga_<STREAM>` at checkout and forwards real `client_id` + `session_id`.

## Checked and correct — do not "fix" these

- **Meta dedup on the site** — browser `fbq(..., {eventID})` and the `/api/meta-capi`
  route send the same `event_id`. Correct on both sides of the cutover.
- **Purchase dedup keys align** across systems: browser and server both use
  `booking-<uuid>` for `transaction_id` / `event_id`, so GA4, Meta and Ads each
  see one sale rather than two.
- **Google Ads server-side is NOT a cutover regression.** The webhook only
  `console.log`s a planned conversion; a real one needs the Google Ads API
  (click-conversion upload with gclid, or Enhanced Conversions). The previous
  pixel ping was removed deliberately because it created untracked conversions.
  Both systems are browser-only for Ads. Worth building — but it is a gap that
  already exists, not something the cutover causes.
- **Conversion value** excludes tax and the platform fee on purpose, and matches
  the `booking.created` envelope so the cockpit's ROAS and Meta's value agree.

## Open — needs access I do not have

**What is inside GTM container `GTM-PNVZ2GWD`.** Miami loads a GTM container
*and* direct gtag. If the container only wraps GA4 / Ads / Meta, then loading it
in the booking app too would **double-count everything we now fire directly** —
which is why the booking app deliberately ignores `mode` and `gtmContainerId`
(it reads five fields and no others; `tracking_config.mode` is recorded as
`direct` for Miami because that is what actually happens).

But if the container also carries Clarity, TikTok, Hotjar or remarketing tags,
those will not fire during checkout at all. **Open the container and list its
tags before cutover** — it is the last unknown in Miami's tracking.
