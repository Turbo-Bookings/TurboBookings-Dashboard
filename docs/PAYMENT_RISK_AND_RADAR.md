# Payment risk, Radar, and the operator readiness gate

> Written 2026-08-20 after reviewing every blocked and failed payment on Dallas
> since go-live. Read this before flipping a new location live, and before
> anyone concludes "Stripe is blocking our customers."

## The short version

Dallas has taken 97 payments: **80 succeeded, 6 refunded, 6 failed, 2 blocked,
0 disputed.** A 2% block rate with zero disputes means we are tuned too tight,
not too loose — but there was nothing to loosen, because **both connected
accounts run Radar Lite, which has no rules at all.** The only lever we had was
the quality of the data we hand Stripe, and we were handing it almost nothing.

## What actually happened to the $290.20

`pi_3U6C4LCxXcDic9eT02BSnmEg`, Aug 19, three attempts inside two minutes:

| Time | Card | Outcome |
|---|---|---|
| 4:10:27 PM | Visa ••••0450 | Bank declined — `do_not_honor` (JPMorgan Chase) |
| 4:11:33 PM | Visa ••••9824 | **Blocked by Radar** |
| 4:12:24 PM | (third attempt) | **Blocked by Radar** |

The customer was not refused for being risky. Their *bank* refused the first
card, and the retry pattern that follows any hard decline — grab another card,
try again — is the same shape as card testing. Radar had nothing to weigh
against it, so it blocked the rest of the session. Billing address was 11412
(Queens, NY) booking a Dallas tour; out-of-state is normal for tours and
suspicious to a generic fraud model.

CVC check: unavailable. ZIP check: unavailable. Customer: **blank**.

That blank customer column is the whole problem.

## Why Radar was flying blind

We collect the buyer's name, email and phone on our own checkout form, then put
them in **PaymentIntent `metadata`** — which Radar cannot read. No Stripe
Customer was attached, `billing_details` carried no name or email, and the
`description` was empty.

So every single charge reached the fraud model as an anonymous first-time buyer
with no email, no name and no history. A customer on their fourth booking looked
exactly like a stranger. Email reputation and prior-success-on-this-account are
the strongest signals Radar has, and it had neither.

Fixed in `bookingsystem` (7b02089, 098aa9b):

- a Stripe **Customer** is found-or-created on the connected account and set on
  the intent — this is what gives Radar history
- **name and email ride on the charge** as `billing_details`, passed at confirm
  with those two fields set to `never` on the Payment Element so the buyer isn't
  asked twice (address stays `auto`, so the postal code is still AVS-checked)
- a readable **`description`** — `1-Hour ATV Tour — Aug 29, 6:00 PM (2 riders)`

The customer attach **fails open**: if the lookup or create errors we build the
intent exactly as before rather than block a sale over an optimisation.

Two traps worth remembering, both of which would have taken checkout down:

1. `setup_future_usage` must stay **unconditional**. The deferred-intent flow
   compares it against the value Elements was given (`CheckoutForm.tsx`) and
   refuses to confirm if they differ.
2. Any billing field set to `never` **must** be supplied at confirm or Stripe
   rejects the payment. Only `name` and `email` are suppressed, because only
   those two are validated non-empty server-side. Phone is optional in our form,
   so it stays on the element's default and reaches Stripe on the Customer.

### It also repaired cards-on-file

`setup_future_usage: "off_session"` only attaches the PaymentMethod when the
intent has a `customer`. Without one, every `pm_` id we stored in
`payment_methods_on_file` was unattached, and `createManualHold` — the security
deposit / damage hold feature — could never have charged any of them. Same fix.

## Radar Lite: there are no rules to review

Both `acct_1U5aMoCxXcDic9eT` (Dallas) and `acct_1U5aMoCWgKniCwxV` (Houston) show
**"Radar Lite is enabled"**. On Lite there are no custom rules, no allow-lists,
no risk-setting choice (Maximize revenue / Balanced / Maximize protection), and
no reviews queue. "Blocked by a Radar rule" means a *built-in Stripe* rule, not
one anybody wrote. Neither we nor the operator can relax it.

**We also cannot see or edit their Radar settings.** We use **direct charges**
(`stripeAccount` + `application_fee_amount`), and Stripe's rule is explicit:
for direct charges to a connected account **with full Dashboard access**, only
the *connected account's* Radar config applies, and it is **not manageable from
the platform Dashboard**. Every future operator inherits this by default, and
each would have to be walked through Radar in their own Stripe account — which
is exactly what "built for non-technical operators" rules out.

## The one lever that scales — measured 2026-08-20, on the platform account

Stripe does expose a platform-level override, and it is real for our Standard
accounts: **Settings → Radar → Platform controls for direct charges → Platform
payments controls → Update configuration** on the **platform** account
(`acct_1FM0clE69fk80FRq`, Yourmusicmanager — *not* Richard's login, which only
sees the two connected accounts).

Current setting: **"Only connected accounts."** The two options that would
centralise anything are greyed out behind *"Upgrade your plan to apply platform
rules to connected accounts"*:

| Option | Effect |
|---|---|
| Only connected accounts | **current** — each operator owns their own Radar; ours never applies |
| Only my platform | our rules apply everywhere; operators lose all Radar control |
| Both my platform and connected accounts | our rules apply everywhere, operators keep theirs; platform rules evaluate first, and an allow rule on either side beats a block rule on the other |

The gate is the platform's **Radar plan**:

| Plan | Price | Notes |
|---|---|---|
| Standard | **$0.00** per screened transaction | **current** — but **$0.05 from Jan 21 2027, 6:00 PM** |
| Plus | **$0.07** per screened transaction | unlocks custom rules, risk tolerance, backtesting **and the platform controls above** |
| Pro | $0.09 + $0.005 per screened customer | adaptive thresholds, multi-account abuse |

Worth knowing before this gets re-litigated: because Standard stops being free
in January 2027, the real delta for Plus is **$0.02** per transaction from then,
not $0.07. At roughly 2,400 attempts/month across two locations that is about
$170/month today, and one recovered booking averages ~$130 — so it pays for
itself at about two rescued bookings a month.

**Decision taken 2026-08-20: not yet.** The identity fix above is the biggest
lever available on Lite and costs nothing; we wait for live data on whether
false blocks persist before spending. Revisit if blocks continue.

### What we ARE doing — free, and strictly better than today 🧑

Both connected accounts sit on **Radar Lite**, which is *below* Standard: no
rules, no allow-lists, no risk-setting choice, no reviews queue, and a blunt
fixed model. **Radar Standard is $0.00 per screened transaction** and adds the
full AI model across all payment methods, default rules and fraud analytics.

This has to be done by **Richard, inside each connected account** — a platform
login cannot reach it. Verified: opening
`dashboard.stripe.com/acct_1U5aMoCxXcDic9eT/settings/plans-and-fees/plans/radar/choose`
while signed in as the platform silently redirects to the platform's own plan
page. That matches Stripe's rule that Radar config for a direct-charge Standard
account is reachable only from that account's Dashboard.

Steps, once per account (Dallas `acct_1U5aMoCxXcDic9eT`, Houston
`acct_1U5aMoCWgKniCwxV`), signed in as `hernandez14_richard@yahoo.com`:

1. Switch to the account in the top-left switcher.
2. **Settings → Radar** → **View plans**.
3. Choose **Standard**. Confirm the price reads **$0.00 per screened
   transaction** in *his* account before accepting — the figures above were read
   on the platform account, and plan pricing is per-account.
4. Repeat for the second location.

Reversible, and it changes nothing about how we charge.

## The readiness gate for a new location

Houston was flipped live on 2026-08-19 before its connected account could take
money. Checkout was dead for ~25 minutes: with `charges_enabled: false` the
Payment Element queries the connected account, finds no available payment
methods, and **renders nothing at all** — no error, just an empty box above a
Pay button that cannot work.

The cause was treating `charges_enabled` and `payouts_enabled` as one condition.
They are different facts and only one is a go-live gate:

| Flag | Meaning | Blocks go-live? |
|---|---|---|
| `charges_enabled` | Customers can pay | **Yes** |
| `payouts_enabled` | Stripe verified the bank account | No — money is held and releases on its own, usually days |

Fixed in the dashboard (a82b707): the connect page now treats `charges_enabled`
as "you're all set" so an owner isn't sent back through KYC over a pending bank
check, and the settings card shows a third state — *taking payments, payouts
pending* — instead of a red herring.

**Before setting `NEXT_PUBLIC_BOOKING_ORIGIN` on a new location, all three:**

1. `charges_enabled = true` on the connected account
2. Load the real checkout and confirm **a card form actually renders** and the
   Pay button shows the right amount. This is the only check that catches an
   inactive `card_payments` capability, and it takes fifteen seconds:
   `https://book.<domain>/<slug>/tours/<item-id>` → pick a slot → Continue
3. One real booking, start to finish, then refund it

Step 2 is the one that would have caught Houston. The account looked connected.

## The other half of the checkout fix (2026-08-20)

Separate from Radar, but the same page: H-Town's checkout showed **Total
$107.40** in the money block while a free-text "Pricing Breakdown" field lower
down said the real number was **$120** — the $20-per-person park admission the
pricing engine knew nothing about. Staff were short too: the manifest asked for
$80 cash on a single rider who actually owed $100.

`locations.venue_fee_per_person_cents` + `venue_fee_label` now model money the
**venue** collects in cash. It is deliberately not ours — excluded from the
discount, the tax base and the platform fee base — and only ever moves
`balanceDueAtVenueCents`, which is labelled "cash, at the venue" everywhere it
surfaces. Default 0, so no other location changed.

Admission is per **head**, and a "Double Rider ATV" is one unit carrying two, so
`customer_types.persons_per_unit` now says how many people a unit puts on the
ground. **Deposits deliberately do not use it** — H-Town's deposit is $20 per
machine and routing it through here would silently double every deposit on a
live location.

Verified live against the operator's own published numbers:

| Selection | Admission | Cash at check-in | Operator says |
|---|---|---|---|
| 1 × Single Rider ATV | $20 | $100.00 | $100 ✓ |
| 1 × Double Rider ATV | **$40** (2 heads) | $170.00 | $170 ✓ |
| 2 × Single Rider ATV | $40 | $200.00 | $200 ✓ |

Our *total* runs higher than the operator's published total by exactly the
online tax + processing fee ($7.40 on a single rider), which their copy omits.
That is the copy being incomplete, not the engine being wrong.

A `notice` custom-field kind was added for the text itself: display-only, stores
nothing, can never be required. The pricing text was a `text` field for want of
it, which put a block of prices in the middle of the contact form dressed up as
a question.

**Open:** H-Town's UTV / Four Seater Buggy is still `persons_per_unit = 1`, so it
shows $20 admission regardless of how many ride. The buggy seats four; if the
park charges each of them, this needs setting to the real number. Left alone
rather than guessed, because it changes what customers are charged.

## Still open

- **$127.00 owed to two customers** from the double-charge race fixed in
  1d26467 — Jennifer Carreon $98.40 (`pi_3U6bTECxXcDic9eT0qgaSlQX`, booking
  #0304 cancelled but never refunded) and togreen46@yahoo.com $28.60 (bookings
  0223 and 0224 are identical duplicates, Aug 29 6 PM). Operator's money to
  move; not issued.
- **Houston is LIVE on our booking system as of 2026-08-20.**
  `NEXT_PUBLIC_BOOKING_ORIGIN=https://book.htownatvrentals.org` is set on
  Production and the site is redeployed: 15 booking links on the homepage, zero
  FareHarbor references, all three tour ids returning 200.
- `fareharbor.com` removed from Houston's GA4 cross-domain linking (property
  "Texas ATV Rentals", stream `G-BQQMF72HGR`); `htownatvrentals.org` on
  *Contains* remains and covers `book.htownatvrentals.org`. **Dallas lives in a
  different GA4 property** — that property has only Houston's stream — so
  Dallas's cross-domain list has not been checked for the same leftover.
- The Stripe Customer / billing-details change has not yet been exercised by a
  real card end to end. The booking-app preview environment has a stale
  `DATABASE_URL` and 500s, so it could not be rehearsed there; the API shape was
  verified against Stripe test mode instead. One live booking would close it.
