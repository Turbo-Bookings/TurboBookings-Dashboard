import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./client";

// Payment operations for the operator backend. All run against the location's
// connected account (`{ stripeAccount }`).
//
// There is deliberately NO platform-account fallback: with no connected
// account, every one of these would run on OUR account with real money — a
// refund would come out of the platform balance, and a hold would authorize a
// customer's card against the wrong merchant. That window is real (between
// clearing a stale test `acct_` and finishing live Connect onboarding), so we
// fail loudly instead.

type Acct = string | null | undefined;

function reqOpts(account: Acct, op: string): Stripe.RequestOptions {
  if (!account) {
    throw new Error(
      `Cannot ${op}: this location has no connected Stripe account. ` +
        `Finish Stripe Connect onboarding under Integrations first.`,
    );
  }
  return { stripeAccount: account };
}

// Full (or partial, when amountCents given) refund of a captured PaymentIntent.
export async function refundPayment(
  paymentIntentId: string,
  account: Acct,
  amountCents?: number,
): Promise<Stripe.Refund> {
  // `refund_application_fee: true` gives the platform fee back to the operator,
  // prorated automatically by Stripe when the refund is partial.
  //
  // This REVERSES the decision of 2026-08-18, deliberately, on 2026-08-21.
  // The fee used to be kept, which made the operator net negative on every
  // refunded booking. Two things settled it:
  //
  //   1. Researching how FareHarbor, Peek and Xola actually word this found our
  //      rule was the outlier. FareHarbor's commission model — the one that
  //      matches ours — returns the commission on a full refund and prorates it
  //      on a partial, and defines commission around activities actually
  //      delivered. Peek contradicts itself across two documents. Xola is
  //      silent. Nobody discloses a term like the old one where an operator
  //      would find it.
  //   2. The term had earned $72.00 in total, across five refunds — 4% of all
  //      platform fee revenue. That is not worth being the outlier over, and it
  //      is not worth the paragraph plus worked example it would need in every
  //      operator agreement.
  //
  // Stripe does not return its own processing fee on a refund either, so the
  // operator is still out roughly 3% whatever we do. Ours on top was what made
  // it punitive rather than merely annoying.
  //
  // The non-refundable term still stands for the monthly RETAINER, which is a
  // subscription rather than a per-booking commission — that is where
  // FareHarbor keeps money regardless too.
  return getStripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      refund_application_fee: true,
      ...(amountCents != null ? { amount: amountCents } : {}),
    },
    reqOpts(account, "issue a refund"),
  );
}

// Manual-capture pre-auth (security hold) on a saved card-on-file.
export async function createManualHold(params: {
  account: Acct;
  paymentMethodId: string;
  amountCents: number;
  metadata?: Record<string, string>;
}): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.create(
    {
      amount: params.amountCents,
      currency: "usd",
      capture_method: "manual",
      confirm: true,
      off_session: true,
      payment_method: params.paymentMethodId,
      metadata: params.metadata,
    },
    reqOpts(params.account, "place a security hold"),
  );
}

export async function captureHold(
  paymentIntentId: string,
  account: Acct,
  amountCents?: number,
): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.capture(
    paymentIntentId,
    amountCents != null ? { amount_to_capture: amountCents } : undefined,
    reqOpts(account, "capture a security hold"),
  );
}

export async function releaseHold(
  paymentIntentId: string,
  account: Acct,
): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.cancel(
    paymentIntentId,
    undefined,
    reqOpts(account, "release a security hold"),
  );
}
