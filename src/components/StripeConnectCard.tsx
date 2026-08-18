"use client";

import { useState, useTransition } from "react";
import type { AccountStatus } from "@/lib/stripe/connect";
import {
  createOperatorOnboardingLink,
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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleGenerateLink() {
    startTransition(async () => {
      const res = await createOperatorOnboardingLink(slug);
      setShareUrl(res.url);
    });
  }

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
    // An id stored but no status means Stripe couldn't resolve it on the current
    // key — nearly always a test→live key change. Say so, rather than showing a
    // bare "Not connected" that makes it look like data was lost.
    const stale = !!accountId && !status;
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Stripe Connect
            </h3>
            {stale ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                The account previously connected here (
                <code className="font-mono">{accountId}</code>) can&apos;t be
                loaded with the current Stripe keys. That&apos;s expected right
                after switching from test to live — test and live connected
                accounts are separate. Reconnect to create the live account and
                onboard it.
              </p>
            ) : (
              <p className="mt-1 text-xs text-zinc-500">
                Connect your Stripe account to accept bookings. We&apos;ll
                redirect you to Stripe to verify identity, link a bank
                account, and finish onboarding. Direct charges land in your
                account; we collect the platform fee automatically.
              </p>
            )}
          </div>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {stale ? "Needs reconnect" : "Not connected"}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-md bg-[#635bff] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#5546e0] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Redirecting to Stripe…" : "Connect Stripe myself"}
          </button>
          <button
            type="button"
            onClick={handleGenerateLink}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {pending ? "Working…" : "Get a link to send the owner"}
          </button>
        </div>

        {/* The share link. Stripe's own Account Links are single-use and expire
            in ~5 minutes, so they can't be emailed; this is a durable URL that
            mints a fresh one on each visit. The owner needs no login. */}
        {shareUrl && (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
            <p className="text-xs font-medium text-emerald-900 dark:text-emerald-100">
              Send this to the business owner
            </p>
            <p className="mt-1 text-[11px] text-emerald-800 dark:text-emerald-300">
              They don&apos;t need an account or a password — the link takes them
              straight into Stripe. Valid for 14 days. Generating a new link
              replaces this one.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded border border-emerald-300 bg-white px-2 py-1 font-mono text-[11px] text-zinc-800 dark:border-emerald-800 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900/40"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
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

      {!fullySetUp && <OutstandingRequirements status={status} />}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!fullySetUp && (
          <>
            <button
              type="button"
              onClick={handleStart}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-md bg-[#635bff] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#5546e0] disabled:opacity-60"
            >
              {pending ? "Loading…" : "Continue onboarding myself"}
            </button>
            {/* A part-finished account is exactly when the OWNER needs a link —
                "Continue onboarding" redirects whoever is sitting at this
                browser, which is us, not them. */}
            <button
              type="button"
              onClick={handleGenerateLink}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {pending ? "Working…" : "Get a link to send the owner"}
            </button>
          </>
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

      {shareUrl && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
          <p className="text-xs font-medium text-emerald-900 dark:text-emerald-100">
            Send this to the business owner
          </p>
          <p className="mt-1 text-[11px] text-emerald-800 dark:text-emerald-300">
            No account or password needed. The link names the business before
            handing off to Stripe, so it can&apos;t be completed against the
            wrong location. Valid 14 days; generating a new link replaces it.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded border border-emerald-300 bg-white px-2 py-1 font-mono text-[11px] text-zinc-800 dark:border-emerald-800 dark:bg-zinc-900 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-100 dark:hover:bg-emerald-900/40"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Human-readable labels for the most common Stripe requirement keys, so the
// operator sees "Bank account" instead of "external_account".
const REQUIREMENT_LABELS: Record<string, string> = {
  external_account: "Bank account (for payouts)",
  "business_profile.url": "Business website URL",
  "business_profile.mcc": "Industry / business category",
  "business_profile.product_description": "Product description",
  "tos_acceptance.date": "Accept Stripe's terms of service",
  "individual.verification.document": "Photo ID document",
  "individual.verification.additional_document": "Additional ID document",
  "individual.id_number": "SSN / tax ID",
  "individual.ssn_last_4": "SSN (last 4)",
};

function prettyRequirement(key: string): string {
  return REQUIREMENT_LABELS[key] ?? key;
}

function OutstandingRequirements({ status }: { status: AccountStatus }) {
  const blocking = [...status.pastDue, ...status.currentlyDue];
  const dedupedBlocking = Array.from(new Set(blocking));
  const hasAny =
    dedupedBlocking.length > 0 ||
    status.pendingVerification.length > 0 ||
    Boolean(status.disabledReason);
  if (!hasAny) {
    // Nothing outstanding but not fully enabled → Stripe is still processing.
    return (
      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        All info submitted — Stripe is finishing verification. Charges usually
        enable within a minute; refresh this page shortly.
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-semibold">Stripe still needs:</p>
      {dedupedBlocking.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {dedupedBlocking.map((r) => (
            <li key={r}>
              {prettyRequirement(r)}{" "}
              <code className="font-mono text-[10px] opacity-60">{r}</code>
            </li>
          ))}
        </ul>
      )}
      {status.pendingVerification.length > 0 && (
        <p className="mt-1">
          Verifying: {status.pendingVerification.map(prettyRequirement).join(", ")}
        </p>
      )}
      {status.disabledReason && (
        <p className="mt-1">
          Reason: <code className="font-mono text-[10px]">{status.disabledReason}</code>
        </p>
      )}
      <p className="mt-1.5 opacity-80">
        Click <span className="font-medium">Continue onboarding</span> to finish
        these in Stripe.
      </p>
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
