# Booking system → ad cockpit revenue feed

**Status:** Canonical for this feed. Written 2026-08-21, when the receiver was built.
**Supersedes:** nothing. Before this, no document described how our own bookings reach the cockpit —
because nothing did.

---

## Why this exists

The cockpit's objective is *"keep ad spend at 10–16% of TRUE revenue"* (`cockpit/STATUS.md:26`). That
denominator came from FareHarbor POSTing every booking to `POST /api/fareharbor/webhook/{market}`.

All three locations have now left FareHarbor, so that feed is silent and the denominator decays to zero.
This feed replaces it.

### What was NOT true before you read this

Three beliefs that cost a research session. All are corrected below:

1. **"The pipe is broken and needs reconnecting."** It was never connected. `source_surface` /
   `occurred_at` appear **nowhere** in `~/takeovers-platform` (0 matches). No receiver for the envelope
   had ever been built, anywhere. 231 events queued from 2026-06-28 against a consumer that could not
   have parsed them.
2. **"The cockpit reads bookings from an Intelligence Neon DB."** `PLATFORM_ARCHITECTURE.md` says this.
   It is false. There is no Intelligence DB. `grep DATABASE_URL|psycopg|sqlalchemy` in the cockpit
   returns **zero hits**. Revenue lives in **one SQLite table on a Railway volume**.
3. **"`REPLIT_WEBHOOK_SECRET` means Replit sends us data."** Nothing is ever sent from Replit. It is the
   key **our storefront signs outbound events with**, named after a receiver that was planned and never
   built. See *Environment variables* below.

---

## Shape of the feed

```
Vercel storefront                        Railway cockpit
─────────────────                        ───────────────
emitEvent()  ──HMAC-SHA256 (raw body)──▶ POST /api/webhooks/turbobookings
   │                                        │
   └─ on any non-2xx ──▶ outbound_event_queue    ├─ verify signature (fails CLOSED)
                              │                  ├─ dedup on event_id
                     /api/cron/retry-events      ├─ location_id (UUID) → market
                     (dashboard, every minute)   └─ bookings.upsert()  ← the SAME ledger
                                                       FareHarbor fed
```

One-way. The cockpit never writes back to the storefront DB.

## The receiver

`POST https://cockpit.turbobookings.net/api/webhooks/turbobookings`

| | |
|---|---|
| Auth | `X-Turbobookings-Signature: sha256=<hex>` — HMAC-SHA256 over the **raw** body |
| Secret | `TURBOBOOKINGS_WEBHOOK_SECRET` on Railway; must equal `BRAIN_WEBHOOK_SECRET` on Vercel |
| Unset secret | **403.** Deliberately unlike `/api/fareharbor/webhook`, which does `if secret and token != secret` and so accepts anything when its secret is missing |
| Dedup | `event_id`, in a `processed_events` table. Repeats return `200 {"duplicate": true}` |
| Unknown `event_type` | **200**, logged, ignored |
| Unknown `location_id` | **200**, logged, ignored |

**Never return 5xx for something we cannot process.** The sender retries any non-2xx up to 6 times and
the queue drains oldest-first, so a permanent 5xx would wedge every later event behind it.

Verify against the **raw** body, never a re-serialized parse — Python and JS disagree on key order and
separators, and the sender signs `JSON.stringify(envelope)` exactly as transmitted.

## Handled event types

| Event | Effect |
|---|---|
| `booking.created` | upsert a ledger row |
| `booking.cancelled` | `status='cancelled'` on that pk; `revenue()` already filters those out |
| `booking.checked_in`, `booking.no_show`, `booking.rescheduled`, `communication.requested` | logged, no revenue effect |
| `inventory.snapshot` | replaces the market's row in `inventory.db` — see below |

## `inventory.snapshot` — physical capacity (added 2026-08-28)

Hourly, one per launched location, from `/api/cron/inventory-snapshot`. Answers the question the spend
objective could never ask: **is there anything left to sell?** The cockpit's only prior notion of
"headroom" was media-side (Meta ad frequency, Google impression share lost to budget), so it would
happily recommend scaling a market whose Saturdays are already turning riders away.

Producer: `src/lib/inventory/` + `src/lib/events/inventorySnapshotPayload.ts`.
Consumer: `cockpit/inventory.py`, in its **own `inventory.db`** — `/data` holds the only copy of
revenue truth and has no backup, so an hourly feed does not share that file.

### ⚠️ It SUPERSEDES; it does not accumulate

Two consecutive snapshots are not two facts — the later replaces the earlier. `event_id` dedup is
therefore **not sufficient**: every snapshot carries a fresh id. Ordering is by `data.captured_at`, and
an out-of-order write is rejected, with an escape hatch that accepts unconditionally once the stored
snapshot is >6h old (otherwise one forward clock jump freezes the feed permanently).

For the same reason the sender passes **`queue_on_failure: false`**. Queueing a failed snapshot is
harmful twice: the retry backoff runs to ~13h, so a 09:00 failure can land at 22:00 and overwrite the
21:00 snapshot; and the drain is a shared 50-per-minute budget, so a receiver outage would queue dead
snapshots *ahead of* `booking.created` and delay revenue truth. Dropping is correct — the next tick
replaces it within the hour and the gap shows up as staleness.

### ⚠️ Nameplate vs serviceable

`resources.out_of_service_count` is a **current** scalar with no history.

* **Structural** (historical fill) divides by **nameplate**. Netting out today's out-of-service count
  would retroactively rewrite every past Saturday the moment a machine goes into the shop.
* **Near-term** divides by **serviceable** (`nameplate − out_of_service`), because those machines
  genuinely cannot be sold today.

Both numbers ship, plus `days_at_or_over_serviceable`, because the gap matters: Dallas's Aug 22 peaked
at 24 ATVs — 88.9% of its 27 nameplate, so it misses a 90% threshold entirely, and **109% of the 22
serviceable**, i.e. oversold.

### ⚠️ Empty is the normal state

Median booking lead time is **0.2 days** (Houston), 0.3 (Miami), 1.2–1.7 (Dallas). A slot three days
out is empty because nobody has booked it *yet*. Read as weak demand it becomes an argument to scale
into nothing. Every day beyond today carries `low_fill_is_not_a_demand_signal: true` so the caveat
travels with the number. Only the positive near-term reading — today or tomorrow at capacity — is
actionable.

### ⚠️ Two different "days"

`lead_time.booking_day_to_tour_day` exists to stop the most expensive available mistake. Google's
`set_ad_schedule` bids on the day an ad is **served**; capacity is about the day a tour **runs**.
Dallas sends 15.9% of all bookings from a Thursday to a Saturday tour, so "Saturday is full" must never
become "bid down Thursday" — that cuts the best-converting day, and those riders book a competitor
rather than a Monday slot.

### Confidence

All three markets went live 2026-08-18..21, so `structural.confidence` reads **`none`** until roughly
November. That is honest, not broken. Do not read the cells while it does.

### Consumption side — what reads this (state 2026-08-29)

The producer and the store are done. The consumption side is done **except the last step**:

| Step | Piece | State |
|---|---|---|
| 1 | Compute + emit hourly (storefront) | ✅ live |
| 2 | `inventory.summary(market)` — downsampled, not 63 raw cells | ✅ live |
| 3 | `pack["inventory"]` in the fact pack | ✅ live |
| 4 | `capacity` key on `efficiency()` | ✅ live |
| 5 | Freshness recomputed at read (the pack caches 12h, a baked age would lie) | ✅ live |
| 6 | Capacity-stale alert, chained below revenue-stale | ✅ live |
| **7** | **Analyst prompt block — `cockpit/analyst.py::_SYSTEM`** | ⛔ **not written** |

**Until step 7 exists, the model has never been told inventory exists.** Steps 3–6 are inert
plumbing. That is intentional: nothing reaches the model until the feed has run a clean 24 hours.

### ⚠️ Open decision — `booking_timing_heatmap`

`cockpit/bookings.py` computes an hour × day-of-week grid of when bookings are MADE (~168 numbers),
embeds it in the fact pack as `pack["fareharbor"]["booking_timing_heatmap"]`, and **nothing reads it** —
not the analyst prompt, not the UI. It predates the inventory work.

Decide it in the same pass as step 7, because the choice interacts with it:

* **Wire it** — the natural use is serving-day ad scheduling (people book Thursday evening → serve
  Thursday evening). But that lever is deliberately deferred (see "two different days" above), so it
  would be a fact with no permitted action attached.
* **Remove it from the fact pack, keep the function** — ⭐ *recommended*. It is ~168 numbers of noise
  in every briefing, and it costs a future session real time to work out whether it is load-bearing.
  Leave a comment saying it belongs with the serving-day work if that is ever built.

Either is fine. Doing nothing is the one bad option: shipping a second never-read fact beside the
inventory block sets the precedent that facts in the pack are decorative.

## Field mapping — and the two that matter

`cockpit/turbobookings.py :: parse_booking_created`

| Ledger column | From | Why |
|---|---|---|
| `pk` | `"tb\|" + data.booking_id` | Namespaced so it can never collide with a FareHarbor pk |
| `market` | `location_id` → map | See below |
| `created_at` | **`envelope.occurred_at`** | ⚠️ see below |
| `tour_at` | `data.scheduled_at` | |
| `revenue_cents` | **`data.subtotal`** | ⚠️ see below |
| `customers` | `data.party_size` | |
| `ref` | `"<click_type>:<click_id>"` | The first values this column has ever held |
| `source` | `'turbobookings'` | Third value, alongside `'csv'` and `'webhook'` |

### ⚠️ `revenue_cents` is `subtotal`, NOT `total`

`_fareharbor_revenue` (`cockpit/api.py`) multiplies **every** row by `FAREHARBOR_BUFFER` (1.12) at read
time, to gross up FareHarbor's ex-tax `receipt_subtotal`. Our `subtotal` is the same quantity — ex-tax,
ex-platform-fee, and already aligned to the conversion value we report to Meta and Google.

Sending `total` would gross up an already-grossed number and **overstate revenue by ~12%**, silently
widening the efficiency band the ad spend is steered by.

### ⚠️ `created_at` is `occurred_at`, NOT receipt time

The ledger keys revenue off `created_at`. The backlog held events up to two months old; stamping them
with receipt time would pile two months of revenue onto a single day and corrupt both the efficiency
window and the dayparting heatmap.

### Tenancy — the vocabularies genuinely differ

The envelope identifies the location by **UUID**; the cockpit keys everything on a **market string**.
Our slugs never appear on the wire, and two of the three differ from the cockpit's names anyway.

```
2a98a883-011f-409b-b63d-a756bcae8a67  miami  → miami
1f61cdbd-e203-4070-8d66-df9f7a98fdfc  htown  → houston
9124c65c-8bd5-4342-b69f-9f776477e77e  dtown  → dallas
```

Map lives in `cockpit/turbobookings.py :: MARKET_BY_LOCATION_ID`, overridable without a deploy via
`TURBOBOOKINGS_LOCATION_MAP="<uuid>=<market>,..."`. **Adding a location means adding a line here** —
until Stage 3 replaces market strings with tenant ids.

## Environment variables

| Where | Variable | Value |
|---|---|---|
| Railway (cockpit) | `TURBOBOOKINGS_WEBHOOK_SECRET` | the shared HMAC key |
| Vercel — **both** projects | `BRAIN_WEBHOOK_URL` | `https://cockpit.turbobookings.net/api/webhooks/turbobookings` |
| Vercel — **both** projects | `BRAIN_WEBHOOK_SECRET` | same value as Railway's |

### On the `REPLIT_WEBHOOK_*` fossil

**Nothing is ever sent from Replit.** These are the keys *our* storefront signs *outbound* events with.
They were named after the receiver planned at the time, which was never built.

`BRAIN_WEBHOOK_*` is now preferred everywhere, with `REPLIT_WEBHOOK_*` kept as a fallback until the old
vars are deleted. Both repos read the same chain — corrected 2026-08-21.

> **The trap this fixes:** the dashboard used to read `REPLIT_WEBHOOK_URL` **only**, while the booking
> system read `BRAIN_` first. Because **the retry cron lives in the dashboard**, setting only
> `BRAIN_WEBHOOK_URL` left the cron and every dashboard-sourced event silently dark while new online
> bookings appeared to deliver perfectly.

**Set both `BRAIN_` vars in both Vercel projects.** Not one, not one project.

## Deploying the cockpit

**The cockpit does NOT deploy from GitHub.** `railway status --json` reports `source: None` — the
service is not connected to the repo. Pushing to `main` deploys nothing.

```bash
cd ~/ads/SHARED
railway up --detach --yes      # linked to project "cockpit", env production
```

Deploys the **local working directory** via Dockerfile, so commit and confirm a clean tree first.
Expect a brief 502 while it restarts. Confirm with:

```bash
curl -sX POST https://cockpit.turbobookings.net/api/webhooks/turbobookings -d '{}'
# {"detail":"receiver not configured"}  → new code live, secret not yet set
# {"detail":"Authentication required."} → OLD code still serving
```

That last distinction matters: an unauthenticated POST to any `/api/` path returns 401 from the Clerk
guard, so **status code alone cannot tell you whether the deploy landed** — read the body.

## Known limits

- **Partial refunds are all-or-nothing.** `booking.cancelled` carries no amount and the ledger has no
  refund column, so a cancellation removes the entire booking from revenue.
- **Dashboard lifecycle events are thin.** `booking.cancelled/checked_in/no_show/rescheduled` carry only
  `{booking_id, display_number}` — no reason, refund amount, or old/new times.
- **Never emit imported FareHarbor bookings.** The rows imported into our DB (`source='api'`,
  `external_ref='fh:…'`) already exist in the cockpit from its own FareHarbor feed. The importer does
  not call `emitEvent` — keep it that way, or those bookings double-count.
- **The Railway `/data` volume is the only copy of revenue truth.** No backup.

## Tests

`cd ~/ads/SHARED && ./venv/bin/python -m cockpit.test_turbobookings`

Offline, no network. Covers fail-closed signature verification, `subtotal`-not-`total`,
`occurred_at`-not-now, replay safety, cancellation, and the location map.
