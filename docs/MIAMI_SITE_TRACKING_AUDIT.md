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

## The decorator bug — read this before forking another site

`decorateFareHarborUrl` guarded on a **hardcoded vendor string**:

```ts
if (!rawHref || !rawHref.includes("fareharbor.com")) return rawHref;   // WRONG
```

The moment a location cuts over, every Book href points at
`book.<their-domain>`, so this early-returns on **every link** and the entire
decorator goes silently dead. Its partner in `BookingLinkDecorator.tsx` had the
same defect — `a[href*="fareharbor.com"]` selects zero anchors. Click ids are
still captured on the marketing site and then forwarded nowhere.

**This was live on Houston for a day** (cut over 2026-08-20, found 2026-08-21).
Nothing alerted, and nothing looked wrong.

**Severity, honestly: attribution did not break.** The booking app reads `_fbc`
and `_gcl_aw` straight off the request because it shares the registrable domain
with the marketing site — the cookie path carried it. The decorator is the
FALLBACK for when those cookies are missing, blocked or cleared between visits.
That is worth having and worth not losing silently, but it is not an outage.

Both now key off `LINKER_DOMAIN`, so they follow wherever the CTAs actually
point, and the function is renamed `decorateBookingUrl` so the name stops
implying a FareHarbor-only scope.

| Site | Status |
|---|---|
| `htown-atv-rentals-site` | Fixed and **on production** |
| `takeovers-site` | Fixed, on `develop` — ships with the cutover |
| `dtown-atv-rentals-site` | **Not affected** — the Dallas fork has neither file |

**The general lesson, which is the reusable part:** anything in a marketing site
that names `fareharbor.com` is a cutover landmine. It keeps working right up
until the day it matters and then fails silently rather than loudly. Grep every
fork for the literal before cutting one over:

```
grep -rn "fareharbor" src/ | grep -v "config/site.ts\|booking-origin"
```

Everything that legitimately survives should read from `LINKER_DOMAIN` /
`ON_CUSTOM_BOOKING`, never from the literal.

## GTM container GTM-PNVZ2GWD — REMOVED 2026-08-21

The open question ("what is inside it?") is closed: **nothing that mattered.**
The component's own comment recorded it — parent site had *no tags*, because
direct gtag.js already handles GA4 and Ads there; the container's only tags were
the purchase conversion and GA4 purchase that fire **inside the FareHarbor
Lightframe**.

So on the parent it loaded on every page load and fired nothing. Removed, script
and `<noscript>` iframe both.

**The FareHarbor Lightframe tags are untouched.** FareHarbor loads the container
inside its own frame independently of the parent; the parent-side load existed
only so GTM Preview could attach to the iframe debug session, and that goes away
with the cutover anyway.

This also settles a design question for good: there was never a case for
teaching the booking app to load a GTM container. It would only have
double-counted the GA4, Ads and Meta events the app already fires directly —
which is why the app reads five `tracking_config` fields and deliberately
ignores `mode` and `gtmContainerId`.

## Also fixed here — GA4 server-side identity (affects ALL locations)

Detail in the booking-app commit; kept here because it was found during this
audit and is not Miami-specific.

`sendGa4` sent `client_id: p.eventId` on a comment claiming no `_ga` cookie is
reachable server-side. Untrue — the booking app shares the registrable domain
and already read `_fbp` / `_fbc` / `_gcl_aw` from the same request.

It only bit when the **browser event was blocked**, which is the one case
server-side tracking exists for, because GA4 dedupes on `transaction_id` and
discards the server copy whenever the browser one arrives. So the bookings
hardest to attribute were attributed worst, and nothing looked wrong.

Now captures `_ga` / `_ga_<STREAM>` at checkout, threads them through the
`CapiContext` that already carries the Meta signals, and sends the real
`client_id` + `session_id` plus `engagement_time_msec: 1`.

## Open — needs access I do not have

Nothing outstanding. The GTM question above was the last one and it is closed.
