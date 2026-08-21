# Terms, agreements, and the acceptance record

> Written 2026-08-21 after researching how FareHarbor, Peek and Xola actually
> bind their operators and travellers. Read this before drafting anything with
> counsel, and before changing how refunds or fees work.

## The two decisions already taken

### 1. The platform fee IS returned on refunds (reversed 2026-08-21)

`refund_application_fee: true` is set in **both** repos:

- `turbobookings-dashboard/src/lib/stripe/payments.ts` — operator-issued refunds
- `bookingsystem/src/app/api/webhooks/stripe/route.ts` — the oversell refund

Stripe prorates it automatically on a partial refund, which matches FareHarbor's
commission rule exactly.

**This reversed the decision of 2026-08-18.** Anything you find that still says
"the 6% is non-refundable, do not add the flag" is stale — the code comment and
`BOOKING_SYSTEM_SPRINTS.md` have both been corrected. Two things settled it:

- **We were the market outlier.** FareHarbor runs two models. Under the default
  the *traveller* pays a booking fee, which is non-refundable — but that is the
  traveller's money and the operator never goes underwater. Under the
  **commission** model, the one that matches ours, a full refund returns the
  full commission and a partial returns a prorated share; commission is defined
  around activities actually delivered. Peek contradicts itself across two
  documents (its addendum retains, its master returns, and the addendum wins).
  Xola is silent. Nobody discloses a term like our old one where an operator
  would find it.
- **It had earned $72.00.** Five refunds, all of them full, across both
  locations — 4% of all platform fee revenue at the time. Not worth being the
  outlier over, and not worth the paragraph plus worked example it would have
  needed in every operator agreement.

Also worth remembering: **Stripe keeps its own processing fee on a refund
regardless**, so the operator is still out roughly 3% whatever we do. Ours on top
was what made it punitive rather than merely annoying.

**The retainer stays non-refundable.** It is a subscription, not a per-booking
commission — and subscription fees are exactly where FareHarbor keeps money
regardless too (API fees once invoiced, hosted-site onboarding).

**Open:** whether to return the $72 already kept to Richard. It is his money and
has not been authorised. Probably cleaner as a credit on a retainer invoice than
five separate Stripe refunds against old bookings.

### 2. There is now an acceptance record, deliberately switched off

`terms_acceptances` (migration 0034) records who accepted what version of which
document, when, from which IP, with which user agent, and — where relevant — for
which location. Unique on `(user_id, document, version, location_id)` with
`NULLS NOT DISTINCT`, so re-accepting is a no-op rather than a duplicate row.

This is the foundation, not an afterthought. **FareHarbor's entire position rests
on an acceptance event recorded in their dashboard** — their provider terms
describe the contract as running from acceptance in the booking system, not from
a signature. None of the wording counsel drafts is worth anything without proof
of who accepted it and when.

**Every document currently carries `version: null`, which means nothing is gated
and nobody is asked.** That is deliberate. Putting placeholder terms in front of
a live operator's staff would be worse than having none — they would accept text
we then replace, and the record would be of the wrong thing.

| To do this | Change this |
| --- | --- |
| Turn it on | Set `version` and `url` in `src/lib/legal/documents.ts` |
| Ask everyone again after an amendment | Bump `version` |
| Produce the record for a lawyer | `npm run terms:status` |

Bumping a version is how an amendment clause gets enforced, so **do not bump one
silently**. FareHarbor commits to 15 days' advance notice before a change takes
effect; whatever period counsel lands on, the bump is the enforcement mechanism.

Two design notes worth preserving:

- The lookup **fails OPEN**, the opposite of `RoleGate`. A bug in terms checking
  must never stop an operator running their business; the worst case is being
  asked to accept twice.
- The registry lives in `src/lib/legal/documents.ts`, free of `server-only`, so a
  CLI script and a future public terms page can both read it. The server-side
  logic is in `src/lib/legal/terms.ts`.

## What the research actually found

Full brief, including the ten questions for counsel:
**https://claude.ai/code/artifact/74ba3158-3bbf-4d6a-a113-03e55afb1822**

The short version:

- **"They never made us sign anything" is probably wrong.** FareHarbor's provider
  terms bind two ways at once — by accepting inside the FareHarbor Booking
  System, *and/or* by using the service. The first describes an in-dashboard
  click during onboarding. Worth asking FareHarbor for that acceptance record
  before assuming it does not exist.
- **Clickwrap for the transactional service, signed paper for the subscription.**
  FareHarbor's hosted-site terms run from a signed commercial order; performance
  marketing from a signed insertion order. Peek uses an executed service order.
  Our retainer is the analogue and probably wants a short signed order form that
  incorporates a clickwrap platform agreement by reference.
- **Nobody is the merchant of record.** All three put the operator there and take
  a narrow, limited-purpose collection role. That validates our Stripe Connect
  direct-charge design, including the consequence that Radar lives in the
  operator's account rather than ours.
- **Travellers see nothing from us today.** FareHarbor uses a passive "by booking
  you agree" line with modal links, plus a disclosed fee row naming itself as
  recipient. Our checkout has operator-written policy checkboxes and no platform
  terms at all — so we have no liability cap, no arbitration position, and no
  disclosure that a platform fee exists. The checkout hook is a small change once
  there is a URL to link to, which waits on the Turbo Bookings marketing site.
- **FareHarbor contracts worldwide through FareHarbor B.V. in Amsterdam**, with
  Dutch law and no arbitration for providers. US travellers get binding
  arbitration and a class-action waiver. A structuring choice worth raising.

## Who this applies to

See the ownership table in `AGENTS.md`. It matters here more than anywhere else:
**Dallas and Houston are third-party operator clients and are already live with
no agreement at all.** Miami is partly ours and carries the least contractual
risk of the three. The exposure is with Richard, and it has been running since
2026-08-18.
