"use client";

import { useTransition } from "react";
import type { AccountStatus } from "@/lib/stripe/connect";
import {
  disconnectStripeAccount,
  openStripeDashboardForLocation,
  startStripeConnectOnboarding,
} from "@/lib/actions/stripe-connect";

type Props = {
  slug: string;
  /** Connected account ID from locations.stripe_account_id; null = not connected */
  accountId: string | null;
  /** Live status from Stripe (null when not connected OR Stripe not configured) */
  status: AccountStatus | null;
  /** Whether STRIPE_SECRET_KEY is configured on the dashboard */
  stripeConfigured: boolean;
};

// Stripe Connect card on the Integrations tab. Three visual states:
//   - Not configured (Stripe key missing on dashboard)
//   - Not connected (button to start onboarding)
//   - Connected with details_submitted/charges_enabled/payouts_enabled flags
export function StripeConnectCard({
  slug,
  accountId,
  status,
  stripeConfigured,
}: Props) {
  const [pending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      await startStripeConnectOnboarding(slug);
    });
  }

  function handleOpenDashboard() {
    startTransition(async () => {
      await openStripeDashboardForLocation(slug);
    });
  }

  function handleDisconnect() {
    if (
      !confirm(
        "Disconnect this Stripe account from the location? The Stripe account itself stays intact — you can reconnect later. Bookings made under this Stripe will no longer process new charges through it.",
      )
    )
      return;
    startTransition(async () => {
      await disconnectStripeAccount(slug);
    });
  }

  if (!stripeConfigured) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
        <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          Stripe Connect — not configured
        </h3>
        <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
          <code className="font-mono">STRIPE_SECRET_KEY</code> isn&apos;t set
          on the dashboard&apos;s Vercel env. Master role configures the
          platform&apos;s Stripe account once; clients then connect their
          own via this card.
        </p>
      </div>
    );
  }

  if (!accountId || !status) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Stripe Connect
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Connect your Stripe account to accept bookings. We&apos;ll
              redirect you to Stripe to verify identity, link a bank
              account, and finish onboarding. Direct charges land in your
              account; we collect the platform fee automatically.
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            Not connected
          </span>
        </div>

        <button
          type="button"
          onClick={handleStart}
          disabled={pending}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-[#635bff] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#5546e0] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Redirecting to Stripe…" : "Connect Stripe"}
        </button>
      </div>
    );
  }

  // Connected — show details + actions
  const fullySetUp =
    status.detailsSubmitted &&
    status.chargesEnabled &&
    status.payoutsEnabled;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Stripe Connect
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            {status.businessProfileName ? (
              <>
                Connected as{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {status.businessProfileName}
                </span>
              </>
            ) : (
              "Connected"
            )}
            {" · "}
            <code className="font-mono text-[10px]">{status.id}</code>
          </p>
        </div>
        {fullySetUp ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
            ✓ Ready
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-200">
            Onboarding incomplete
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <StatusBadge label="KYC submitted" ok={status.detailsSubmitted} />
        <StatusBadge label="Charges enabled" ok={status.chargesEnabled} />
        <StatusBadge label="Payouts enabled" ok={status.payoutsEnabled} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!fullySetUp && (
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-md bg-[#635bff] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#5546e0] disabled:opacity-60"
          >
            {pending ? "Loading…" : "Continue onboarding"}
          </button>
        )}
        <button
          type="button"
          onClick={handleOpenDashboard}
          disabled={pending}
          className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Open Stripe dashboard
        </button>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={pending}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className={`rounded-md border px-2 py-1.5 text-center ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
    >
      <div className="font-mono text-[14px] leading-none">{ok ? "✓" : "—"}</div>
      <div className="mt-0.5 leading-tight">{label}</div>
    </div>
  );
}
