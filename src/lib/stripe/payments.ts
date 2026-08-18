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
  // NOTE: `refund_application_fee` is deliberately NOT set. On a Connect direct
  // charge that means the refund comes wholly out of the connected account's
  // balance and the platform keeps its 6% — the operator nets negative on a
  // refunded booking. This is an intentional commercial term (non-refundable
  // platform fee), decided 2026-08-18 and disclosed in the operator agreement.
  // Do not add the flag without a deliberate decision to change revenue terms.
  return getStripe().refunds.create(
    {
      payment_intent: paymentIntentId,
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
