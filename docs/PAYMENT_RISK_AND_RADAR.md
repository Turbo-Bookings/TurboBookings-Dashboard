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

## The one lever that scales — 🧑 needs the platform login

Stripe exposes a platform-level override for precisely this case. Signed in as
the **platform** account (Yourmusicmanager / Turbo Bookings — *not* Richard's
login, which only sees the two connected accounts):

1. **Settings → Radar**
2. **Platform controls for direct charges → Platform payments controls →
   Update configuration**
3. Choose **"Both my platform and connected accounts"**

That makes our rules apply to direct charges on *every* connected account,
present and future, while leaving an operator able to allow-list their own
regulars. Platform rules evaluate first, and an allow rule on either side beats
a block rule on the other. "Only my platform" is the stricter alternative and
takes the ability away from operators entirely.

Caveat to check while you're on that screen: Stripe notes these settings apply
to "connected accounts controlled solely by your platform," and ours are
**Standard** accounts. If the option isn't offered, the fallback is per-operator
and belongs in the onboarding runbook rather than in code.

Once the control exists, the rules worth having are few:

- allow when the email has already succeeded on this account — repeat customers
  should never be blocked, and this is the case the Customer attach now enables
- do not treat a retry after a `do_not_honor` as card testing on its own
- review, don't block, above a dollar threshold — a large-group booking is our
  best transaction, and 0 disputes in 97 payments says the risk is theoretical

With 0 disputes, the correct risk setting is **Maximize revenue**.

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

## Still open

- **$127.00 owed to two customers** from the double-charge race fixed in
  1d26467 — Jennifer Carreon $98.40 (`pi_3U6bTECxXcDic9eT0qgaSlQX`, booking
  #0304 cancelled but never refunded) and togreen46@yahoo.com $28.60 (bookings
  0223 and 0224 are identical duplicates, Aug 29 6 PM). Operator's money to
  move; not issued.
- Houston is confirmed able to take payments — checkout renders a card form and
  Pay $27.40 — so the cutover env var can be re-set on Production.
