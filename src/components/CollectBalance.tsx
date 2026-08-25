"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard } from "lucide-react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createBalanceIntent, recordBalancePayment } from "@/lib/actions/collectBalance";
import type { BalanceQuoteView } from "@/lib/booking/balanceCharge";

const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Take the balance on a card, at the desk.
 *
 * Collapsed by default. Most bookings at check-in are settled in cash or were paid online, and an
 * always-open card form invites someone to charge a card that has already been charged.
 *
 * The amount is stated before the form opens, and where it differs from the plain balance the reason
 * is spelled out — a walk-in booked as pay-at-venue is quoted the tour price with no booking fee, so
 * choosing to pay by card costs 6% more, exactly as it would have if the card had been taken up
 * front. The person reading this has a customer in front of them and needs the sentence, not a
 * reconciliation.
 */
export function CollectBalance({
  slug,
  quote,
  publishableKey,
  stripeAccount,
  onPaid,
  onBusyChange,
}: {
  slug: string;
  quote: BalanceQuoteView;
  publishableKey: string | null;
  stripeAccount: string | null;
  /** Refresh the surrounding view. The page refreshes the route; the modal refetches itself. */
  onPaid?: () => void;
  /**
   * Raised while a charge is in flight, so the host can refuse to disappear underneath it. The window
   * between "card submitted" and "payment recorded" is the one moment where losing this component
   * means a customer is charged and the booking never hears about it.
   */
  onBusyChange?: (busy: boolean) => void;
}) {
  // The quote is FROZEN when the form opens. Any other action in the modal — a rider added at the
  // next desk, a reload triggered elsewhere — pushes a fresh `quote` prop down, and letting that
  // reach a mounted <Elements> changes the amount out from under a card that is already being typed.
  // The server re-derives the amount at charge time regardless, and refuses if it has moved, so
  // freezing here costs nothing and removes a whole class of surprise.
  const [locked, setLocked] = useState<BalanceQuoteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = locked !== null;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Guards the crudest interruption of all — closing the tab or hitting back mid-charge. The browser
  // shows its own generic "leave site?" prompt; the wording is not ours to choose, but the stop is.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy assignment, still required by Chrome for the prompt to appear.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!publishableKey) return null;
    // The charge lives on the CONNECTED account, so the Elements instance must be pinned to it too.
    return loadStripe(publishableKey, stripeAccount ? { stripeAccount } : undefined);
  }, [publishableKey, stripeAccount]);

  if (!quote.chargeable) {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Collect balance
          </h3>
          <p className="mt-1 text-sm">
            <span className="font-semibold tabular-nums">{usd(quote.chargeCents)}</span>{" "}
            <span className="text-zinc-500">to charge by card</span>
          </p>
          {quote.feeAddedCents > 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              That is {usd(quote.balanceDueCents)} plus a {usd(quote.feeAddedCents)} booking fee.{" "}
              {quote.feePricedCents === 0
                ? "This reservation was taken as pay-at-venue, so no booking fee was charged up front — paying by card adds it, exactly as booking with a card would have."
                : "This reservation grew in value after it was booked and the booking fee never caught up — this brings it to the full 6%."}{" "}
              Paying cash? Collect {usd(quote.balanceDueCents)} and leave this alone.
            </p>
          )}
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setLocked(quote)}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <CreditCard className="h-4 w-4" /> Charge a card
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}

      {/* Says out loud what the disabled close button only implies. Someone at a desk needs to know
          the screen is frozen ON PURPOSE, or they will start hunting for a way out of it. */}
      {busy && (
        <p className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          Payment going through — don&apos;t close this window. It will unlock on its own.
        </p>
      )}

      {locked && (
        <div className="mt-3">
          {!stripePromise ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Stripe isn&apos;t configured for this location, so a card can&apos;t be charged here.
            </p>
          ) : (
            <Elements
              stripe={stripePromise}
              options={{
                mode: "payment",
                amount: locked.chargeCents,
                currency: "usd",
                setupFutureUsage: "off_session",
                // Card ONLY, and it must match `payment_method_types` on the intent or deferred-intent
                // mode refuses to confirm. Wallets also finish through a redirect whose promise never
                // settles if the overlay is blocked — the frozen button from the new-booking form.
                paymentMethodTypes: ["card"],
                // "en", not "en-US": StripeElementLocale has no en-US member.
                locale: "en",
              }}
            >
              <BalanceCheckout
                slug={slug}
                bookingId={locked.bookingId}
                amountCents={locked.chargeCents}
                onError={setError}
                onBusy={setBusy}
                onPaid={onPaid}
                onCancel={() => {
                  setLocked(null);
                  setError(null);
                }}
              />
            </Elements>
          )}
        </div>
      )}
    </div>
  );
}

function BalanceCheckout({
  slug,
  bookingId,
  amountCents,
  onError,
  onBusy,
  onPaid,
  onCancel,
}: {
  slug: string;
  bookingId: string;
  amountCents: number;
  onError: (e: string) => void;
  onBusy: (busy: boolean) => void;
  onPaid?: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusyLocal] = useState(false);
  const setBusy = (v: boolean) => {
    setBusyLocal(v);
    onBusy(v);
  };
  const [, startRefresh] = useTransition();
  const router = useRouter();

  async function charge() {
    if (!stripe || !elements) return;
    onError("");
    setBusy(true);
    // Every exit goes through `finally`. Without it, a rejection anywhere — a failed action, a tab
    // left open across a deploy, an IntegrationError on an amount mismatch — leaves the button stuck
    // on "Charging…" with nothing shown and nothing logged.
    try {
      const { error: subErr } = await elements.submit();
      if (subErr) {
        onError(subErr.message ?? "Check the card details");
        return;
      }
      const intent = await createBalanceIntent(slug, bookingId);
      if (!intent.ok) {
        onError(intent.error);
        return;
      }
      // The amount is fixed server-side, so a booking edited in another tab since this form opened
      // would be charged the NEW amount while the screen still shows the old one. Stop rather than
      // charge a number nobody agreed to.
      if (intent.chargeCents !== amountCents) {
        onError(
          `The balance changed to ${usd(intent.chargeCents)} while this was open. Reload and try again.`,
        );
        return;
      }
      const { error: confErr, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: intent.clientSecret,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (confErr) {
        onError(confErr.message ?? "Payment failed");
        return;
      }
      // `processing` is a success here: the money has moved and Stripe will settle it. Calling it a
      // failure means a charged customer is told the payment failed.
      const ok =
        paymentIntent && ["succeeded", "processing"].includes(paymentIntent.status);
      if (!ok) {
        onError(
          paymentIntent ? `Payment did not complete (${paymentIntent.status}).` : "Payment failed",
        );
        return;
      }
      const r = await recordBalancePayment(slug, bookingId, paymentIntent.id);
      if (!r.ok) {
        // The card HAS been charged by now. Say so plainly, or the desk runs it again.
        onError(`${r.error} — the card WAS charged, so do not retry. Check the payments list.`);
        return;
      }
      onCancel();
      if (onPaid) onPaid();
      else startRefresh(() => router.refresh());
    } catch (e) {
      onError(
        e instanceof Error
          ? e.message
          : "Something went wrong taking the payment. Check the payments list before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <PaymentElement
        options={{
          // The venue's own country, not whatever IP the browser sits behind.
          defaultValues: { billingDetails: { address: { country: "US" } } },
        }}
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !stripe}
          onClick={charge}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Charging…" : `Charge ${usd(amountCents)}`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
