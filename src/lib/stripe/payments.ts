import "server-only";
import type Stripe from "stripe";
import { getStripe } from "./client";

// Payment operations for the operator backend. All run against the location's
// connected account when present (`{ stripeAccount }`), else the platform
// account (test/un-onboarded fallback) — mirror of the customer-flow charge path.

type Acct = string | null | undefined;
function reqOpts(account: Acct): Stripe.RequestOptions | undefined {
  return account ? { stripeAccount: account } : undefined;
}

// Full (or partial, when amountCents given) refund of a captured PaymentIntent.
export async function refundPayment(
  paymentIntentId: string,
  account: Acct,
  amountCents?: number,
): Promise<Stripe.Refund> {
  return getStripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      ...(amountCents != null ? { amount: amountCents } : {}),
    },
    reqOpts(account),
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
    reqOpts(params.account),
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
    reqOpts(account),
  );
}

export async function releaseHold(
  paymentIntentId: string,
  account: Acct,
): Promise<Stripe.PaymentIntent> {
  return getStripe().paymentIntents.cancel(
    paymentIntentId,
    undefined,
    reqOpts(account),
  );
}
