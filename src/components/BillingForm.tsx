"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CreditCard } from "lucide-react";
import {
  cancelRetainer,
  createRetainerSetup,
  saveRetainerCard,
  startRetainer,
  type RetainerFormState,
  type RetainerValues,
} from "@/lib/actions/billing";

const input =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const STATUS_TONE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  past_due: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  canceled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  inactive: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};
const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  past_due: "Payment failed",
  canceled: "Canceled",
  inactive: "Not started",
};

export function BillingForm({
  slug,
  action,
  initial,
  canManage,
}: {
  slug: string;
  action: (prev: RetainerFormState | null, formData: FormData) => Promise<RetainerFormState>;
  initial: RetainerValues;
  canManage: boolean;
}) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ clientSecret: string; pk: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startT] = useTransition();

  async function beginAddCard() {
    setErr(null);
    const r = await createRetainerSetup(slug);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setSetup({ clientSecret: r.clientSecret, pk: r.publishableKey });
  }

  function subAction(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    startT(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <div className="max-w-lg space-y-6">
      {/* Card on file — any role (the operator is the payer) */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Card on file</h2>
        <p className="mt-1 text-xs text-zinc-500">
          The business card we charge for your monthly retainer. Stored securely with Stripe.
        </p>

        {initial.hasCard && !setup && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <CreditCard className="h-4 w-4 text-zinc-500" />
            <span className="font-medium capitalize">{initial.cardBrand ?? "Card"}</span>
            <span className="text-zinc-500">···· {initial.cardLast4}</span>
          </div>
        )}

        {setup ? (
          <CardSetup
            slug={slug}
            clientSecret={setup.clientSecret}
            pk={setup.pk}
            onCancel={() => setSetup(null)}
            onSaved={() => {
              setSetup(null);
              router.refresh();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={beginAddCard}
            className="mt-3 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {initial.hasCard ? "Update card" : "Add card"}
          </button>
        )}
      </section>

      {/* Retainer amount + billing day — admin only */}
      {canManage ? (
        <RetainerConfig action={action} initial={initial} />
      ) : (
        <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-semibold">Your retainer</h2>
          <p className="mt-2 text-zinc-600 dark:text-zinc-300">
            {initial.amount
              ? `${usd(Math.round(Number(initial.amount) * 100))} / month`
              : "Not configured yet."}
            {initial.billingDay ? ` · billed on day ${initial.billingDay}` : ""}
          </p>
        </section>
      )}

      {/* Status + start/cancel — admin only */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Subscription</h2>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[initial.status]}`}>
            {STATUS_LABEL[initial.status] ?? initial.status}
          </span>
        </div>
        {canManage && (
          <div className="mt-3 flex gap-2">
            {!initial.hasSubscription ? (
              <button
                type="button"
                disabled={pending || starting || !initial.hasCard || !initial.amount}
                onClick={() => {
                  setStarting(true);
                  subAction(() => startRetainer(slug).finally(() => setStarting(false)));
                }}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                title={!initial.hasCard ? "Add a card first" : !initial.amount ? "Set the amount first" : undefined}
              >
                Start retainer
              </button>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => subAction(() => cancelRetainer(slug))}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                Cancel retainer
              </button>
            )}
          </div>
        )}
        {initial.hasSubscription && initial.status === "active" && (
          <p className="mt-2 text-xs text-zinc-500">First charge lands on your billing day; renews monthly.</p>
        )}
      </section>

      {err && <p className="text-sm font-medium text-red-600 dark:text-red-400">{err}</p>}
    </div>
  );
}

// Admin: amount + billing day form (useActionState).
function RetainerConfig({
  action,
  initial,
}: {
  action: (prev: RetainerFormState | null, formData: FormData) => Promise<RetainerFormState>;
  initial: RetainerValues;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? { amount: initial.amount, billingDay: initial.billingDay };
  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">Retainer (admin)</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="amount">Monthly amount ($)</label>
          <input id="amount" name="amount" defaultValue={v.amount} placeholder="3250" inputMode="decimal" className={input} />
        </div>
        <div>
          <label className={label} htmlFor="billingDay">Billing day (1–28)</label>
          <input id="billingDay" name="billingDay" defaultValue={v.billingDay} placeholder="1" inputMode="numeric" className={input} />
        </div>
      </div>
      <p className="text-xs text-zinc-500">Charged in addition to the 6% per-booking fee. Changing the amount updates a running subscription.</p>
      {state && !state.ok && <p className="text-xs font-medium text-red-600 dark:text-red-400">{state.error}</p>}
      {state?.ok && <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Saved.</p>}
      <button type="submit" disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

// Stripe Elements SetupIntent card entry — mounted on the PLATFORM account
// (loadStripe with NO { stripeAccount }).
function CardSetup({
  slug,
  clientSecret,
  pk,
  onCancel,
  onSaved,
}: {
  slug: string;
  clientSecret: string;
  pk: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const stripePromise = useMemo<Promise<Stripe | null>>(() => loadStripe(pk), [pk]);
  return (
    <div className="mt-3">
      <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
        <CardInner slug={slug} onCancel={onCancel} onSaved={onSaved} />
      </Elements>
    </div>
  );
}

function CardInner({ slug, onCancel, onSaved }: { slug: string; onCancel: () => void; onSaved: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error: confirmErr, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (confirmErr) {
      setError(confirmErr.message ?? "Card could not be saved.");
      setBusy(false);
      return;
    }
    if (!setupIntent?.id) {
      setError("Card setup did not complete.");
      setBusy(false);
      return;
    }
    const r = await saveRetainerCard(slug, setupIntent.id);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="space-y-3">
      <PaymentElement options={{ layout: "tabs" }} />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !stripe}
          onClick={submit}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save card"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Cancel
        </button>
      </div>
    </div>
  );
}
