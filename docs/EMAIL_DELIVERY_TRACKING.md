# Email delivery tracking — design + findings (deferred, not started)

> Status: **backlog**, agreed 2026-08-18. Not launch-blocking. Build this before the
> post-launch tracking deep-dive so the UI exists when you go looking.
>
> Spans BOTH repos: schema + webhook in `~/bookingsystem`, UI in `~/turbobookings-dashboard`.

## The problem

You cannot currently answer *"did this customer get their email?"* from the
dashboard — or from the database — for any email type.

### What is recorded today

| Email | Row in `scheduled_emails`? | Notes |
|---|---|---|
| Booking confirmation | ❌ **none** | `sendBookingConfirmation()` sends directly and writes nothing anywhere |
| `reminder_24h` / `reminder_2h` | ✅ | via `enqueueEmail()` |
| `post_tour_review` | ✅ | |
| `cancellation` / `reschedule` | ✅ | verified sending in production 2026-08-18 |
| `abandoned_cart_1` / `_2` | ✅ | |

So the single most important customer email — the confirmation — is the one with
no record at all.

### `sent` is not `delivered`

Even for the emails we do record, `sent_at` means *"Resend accepted the API
call"*, not *"it reached the inbox"*. The gap:

- **sent** → `sent_at` + `resend_email_id` populated
- **delivered** → **not tracked anywhere**
- **bounced / complained** → tracked, but only as a row in `email_suppressions`,
  **not linked back** to the booking or to the specific email

`bookingsystem/src/app/api/webhooks/resend/route.ts` handles only
`email.bounced` and `email.complained`, and matches on recipient address + a
location tag. It never looks at `resend_email_id`, so a bounce cannot be tied to
the message that bounced.

### No UI at all

Nothing in either repo renders `scheduled_emails`. Confirmed by grep across
`src/components` and `src/app` — zero references. The booking detail page shows
no email information whatsoever.

## Recommended approach

**1. Make the confirmation a `scheduled_emails` row rather than a separate log.**
Add `confirmation` to `scheduledEmailTypeEnum` (currently: `reminder_24h`,
`reminder_2h`, `abandoned_cart_1`, `abandoned_cart_2`, `post_tour_review`,
`cancellation`, `reschedule`). Have `sendBookingConfirmation()` insert the row
with `scheduled_at = now()` and stamp `sent_at` + `resend_email_id` on success,
`last_error` on failure.

*Why one table, not a new `email_sends` log:* the UI wants a single per-booking
timeline (confirmation → 24h → 2h → review). One table = one query, one
component, and the idempotency-key machinery already exists. A second table
means a union in every read.

**2. Add real delivery status.** New nullable columns on `scheduled_emails`:
`delivered_at`, `bounced_at`, `failure_reason`. Extend the Resend webhook to
handle `email.delivered`, `email.bounced`, `email.complained` and update the row
**matched on `resend_email_id`** (add an index). Keep the existing
`email_suppressions` write — that logic is correct and independent.

**3. Surface it on the booking detail page** (`bookings/[id]/page.tsx`), which
today shows nothing. A compact timeline per email: type · scheduled time · state
badge (`pending` / `sent` / `delivered` / `bounced` / `cancelled`) · error on
hover. That directly answers "how do we tell in the UI if an email was
delivered" — the state badge is the answer, and `delivered` only appears once
Resend confirms it.

## Gotchas worth carrying forward

- **Resend must be configured to send delivery webhooks.** Bounce/complaint are
  already wired; `email.delivered` may need enabling in the Resend dashboard.
  Without it, everything sits at `sent` forever and the feature looks broken.
- **Backfill is not possible.** Emails already sent have no rows; the 185
  imported bookings' reminders will only gain delivery status going forward.
- **Do not double-send on retry.** The confirmation insert must use the same
  `onConflictDoNothing` idempotency-key pattern as `enqueueEmail()`, keyed
  `confirmation:<bookingId>`.
- **`@import.invalid` addresses** must never be attempted — see the synthetic
  address guard in `lib/booking/lifecycleEmails.ts`.

## Verified working as of 2026-08-18 (don't re-litigate)

- The send pipeline itself is fine. A real `cancellation` email sent
  successfully in production at 06:17 UTC via the cron, which proves
  `emailConfigured()` is true, `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS` are set
  correctly, and the cron drains the queue.
- Sender: `reservations@send.turbobookings.net`, reply-to the location's own
  address (`dtownatvrentals@gmail.com` for Dallas).
- Cancelling a booking correctly cancels its pending reminders
  (`canceled_at` stamped on all three) and sends the cancellation email.
