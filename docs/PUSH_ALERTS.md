# Operator booking alerts (web push)

Push-only, by decision — no email. A new-booking email would land in the same
inbox as the customer confirmations and be ignored within a week.

## What happens

1. A booking is created (online checkout or phone booking).
2. `/api/cron/booking-alerts` runs every minute, picks up bookings created in
   the last **20 minutes** with `alerted_at IS NULL`, and pushes to every device
   subscribed **at that location**.
3. `bookings.alerted_at` is stamped whether or not anyone was subscribed, so the
   booking gets exactly one chance at an alert.

Tapping the notification opens `/locations/<slug>/bookings/<id>`.

## Who gets them

Anyone with `manage_bookings` at the location — director and above — plus global
`master` / `admin` at every location. `basic_user` (front-line check-in staff) is
excluded: they can't act on a sale and would mute the channel.

The role is checked **once, at subscribe time**. The subscription row is the
record of entitlement; the send path never reads Clerk. Removing someone's
access does not delete their rows — if that matters, delete them from
`push_subscriptions` directly.

## Turning it on

Per **device**, not per account — a push subscription belongs to one browser
install. The toggle is on the location dashboard, under the stat tiles.

**iPhone requires the dashboard to be installed to the Home Screen first**
(Share → Add to Home Screen, then open it from the new icon). This is an Apple
restriction: Safari only exposes the Push API inside an installed PWA. The
toggle detects this and shows the three steps instead of a dead button.
Android/Chrome and desktop work without installing.

## Verifying

    npm run push:status -- dtown

- `subscribed devices` — who is actually reachable, with failure counts.
- `pending_in_window` — bookings waiting on the next tick. Persistently non-zero
  means the cron is not running or is erroring.
- The **Send test** button next to the toggle proves the whole chain
  (permission → service worker → push service → OS) on one device.

## Failure handling

A `404`/`410` from the push service means the browser revoked the subscription —
the row is **deleted** immediately. Anything else increments `failure_count` and
leaves the row alone; transient push-service errors must not silently
unsubscribe someone.

Messages carry `TTL: 3600`. An alert that can't be delivered within the hour is
dropped rather than arriving stale — by then the booking is visible in the
dashboard anyway. Same reasoning behind the 20-minute pickup window: a cron
outage drops those alerts instead of delivering a burst of old ones.

## Config

`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — set in
all three Vercel scopes. Without them the sender no-ops and the toggle hides
itself, so a missing key degrades to "no alerts", never to an error.
