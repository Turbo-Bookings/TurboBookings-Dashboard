import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb, locations } from "@/lib/db";
import { getStripe } from "@/lib/stripe/client";

// Platform Stripe webhook for the monthly RETAINER subscriptions (charged on the
// platform account, not connected accounts). Keeps locations.retainer_status in
// sync. Public route (see src/middleware.ts) — trust comes from the Stripe
// signature, not Clerk. Configure a Stripe webhook endpoint → this URL with
// STRIPE_WEBHOOK_SECRET.

export const dynamic = "force-dynamic";

type RetainerStatus = "active" | "past_due" | "canceled";

// Map a Stripe subscription status to our coarse retainer status.
function mapSubStatus(s: Stripe.Subscription.Status): RetainerStatus {
  if (s === "active" || s === "trialing") return "active";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "past_due"; // past_due | unpaid | incomplete | paused
}

async function setStatusBySubscription(subscriptionId: string | null, status: RetainerStatus): Promise<void> {
  if (!subscriptionId) return;
  await getDb()
    .update(locations)
    .set({ retainerStatus: status, updatedAt: new Date() })
    .where(eq(locations.stripeSubscriptionId, subscriptionId));
}

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return new Response("webhook not configured", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("stripe webhook signature verification failed", err);
    return new Response("bad signature", { status: 400 });
  }

  try {
    // Stripe sets subscription.status = past_due on a failed invoice and back to
    // active on recovery (each firing customer.subscription.updated), and
    // canceled on cancellation — so these two events cover every status change.
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await setStatusBySubscription(sub.id, mapSubStatus(sub.status));
        break;
      }
      default:
        break; // ignore everything else
    }
  } catch (err) {
    console.error("retainer webhook handling failed", err);
    return new Response("handler error", { status: 500 }); // Stripe retries
  }

  return new Response("ok", { status: 200 });
}
