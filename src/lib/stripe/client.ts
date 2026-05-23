import "server-only";
import Stripe from "stripe";

// Stripe Platform client — uses YOUR Stripe account's secret key.
// All operations against connected accounts pass the connected `acct_…`
// ID via Stripe-Account header (handled per-call by passing `stripeAccount`
// in the request options).
//
// Lazy singleton so a missing STRIPE_SECRET_KEY only fails when actually
// reaching for a Stripe operation, not at module load.

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  // Pinning is optional — the Stripe SDK uses the account's default API
  // version when omitted, which is what we want for forward compatibility.
  client = new Stripe(key, { typescript: true });
  return client;
}

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function stripePublishableKey(): string | null {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;
}
