"use client";

import { useActionState, useState } from "react";
import type { TaxesFeesState } from "@/lib/actions/pricing";

const input =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";

const MODE_OPTS = [
  { v: "passed_to_customer", label: "Passed to customer" },
  { v: "absorbed_by_client", label: "Absorbed (you pay it)" },
];
const DEPOSIT_OPTS = [
  { v: "full", label: "Full payment" },
  { v: "flat", label: "Flat amount" },
  { v: "per_person", label: "Per person" },
  { v: "per_unit", label: "Per unit" },
  { v: "percent", label: "Percent of subtotal" },
];

export function TaxesFeesForm({
  action,
  initial,
  showFee = true,
}: {
  action: (prev: TaxesFeesState | null, formData: FormData) => Promise<TaxesFeesState>;
  initial: TaxesFeesState["values"];
  // The processing/platform fee is Turbo-only (manage_platform); operators
  // don't see it. Defaults true so admin/master keep it.
  showFee?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;
  const err = state?.errors ?? {};
  const [depositMode, setDepositMode] = useState(v.depositMode);

  return (
    <form action={formAction} className="max-w-lg space-y-6">
      {/* Taxes */}
      <section
        data-tour="taxes-rate"
        className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-sm font-semibold">Sales tax</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Rate (%)</label>
            <input name="taxRatePct" defaultValue={v.taxRatePct} className={input} inputMode="decimal" placeholder="8.25" />
            {err.taxRate && <p className="mt-1 text-xs text-red-600">{err.taxRate}</p>}
          </div>
          <div>
            <label className={label}>Mode</label>
            <select name="taxMode" defaultValue={v.taxMode} className={input}>
              {MODE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* Processing fee — Turbo-only (manage_platform) */}
      {showFee && (
        <section
          data-tour="processing-fee"
          className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-sm font-semibold">Processing fee</h2>
          <p className="text-xs text-zinc-500">The platform fee. Collected on every card charge (never on walk-in / Groupon).</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Rate (%)</label>
              <input name="platformFeePct" defaultValue={v.platformFeePct} className={input} inputMode="decimal" placeholder="6" />
              {err.platformFee && <p className="mt-1 text-xs text-red-600">{err.platformFee}</p>}
            </div>
            <div>
              <label className={label}>Mode</label>
              <select name="platformFeeMode" defaultValue={v.platformFeeMode} className={input}>
                {MODE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Only rendered for manage_platform, and only meaningful once a venue
              fee exists — an operator must never see or set this. */}
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="venueFeeInPlatformFeeBase"
              value="1"
              defaultChecked={v.venueFeeInPlatformFeeBase}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Also charge the fee on the venue fee
              <span className="mt-0.5 block text-xs text-zinc-500">
                Off by default. The venue fee is cash the customer hands the park,
                so we never touch it — turning this on adds the percentage to the
                amount charged online instead. On a $20 admission at 6% that is
                $1.20 more per person online; the customer still pays the park the
                full $20 in cash.
                {!v.venueFeeAmount && " This location has no venue fee set, so it changes nothing today."}
              </span>
            </span>
          </label>
        </section>
      )}

      {/* Deposit */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Deposit</h2>
        <p className="text-xs text-zinc-500">How much of the tour cost is collected up-front (full / deposit options on the booking form).</p>
        <div className="mt-3 space-y-3">
          <div>
            <label className={label}>Deposit mode</label>
            <select name="depositMode" value={depositMode} onChange={(e) => setDepositMode(e.target.value)} className={input}>
              {DEPOSIT_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          {["flat", "per_person", "per_unit"].includes(depositMode) && (
            <div>
              <label className={label}>Deposit amount ($)</label>
              <input name="depositAmount" defaultValue={v.depositAmount} className={`${input} w-40`} inputMode="decimal" placeholder="80" />
            </div>
          )}
          {depositMode === "percent" && (
            <div>
              <label className={label}>Deposit percent (%)</label>
              <input name="depositPercent" defaultValue={v.depositPercent} className={`${input} w-40`} inputMode="decimal" placeholder="30" />
            </div>
          )}
          {err.deposit && <p className="text-xs text-red-600">{err.deposit}</p>}
        </div>
      </section>

      {/* Venue fee — money the customer pays the VENUE, not us */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold">Venue fee (cash, at check-in)</h2>
        <p className="text-xs text-zinc-500">
          A per-person charge the venue collects in cash — park admission, a gate
          fee, wristbands. We never touch this money: it isn&rsquo;t taxed, isn&rsquo;t
          discounted and no processing fee is taken on it. Setting it here adds
          it to the customer&rsquo;s total and to the cash your staff collect on the
          manifest. Leave blank if there isn&rsquo;t one.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <div>
            <label className={label}>Amount per person ($)</label>
            <input
              name="venueFeeAmount"
              defaultValue={v.venueFeeAmount}
              className={`${input} w-40`}
              inputMode="decimal"
              placeholder="20"
            />
          </div>
          <div>
            <label className={label}>What to call it</label>
            <input
              name="venueFeeLabel"
              defaultValue={v.venueFeeLabel}
              className={`${input} w-56`}
              placeholder="Park admission"
            />
          </div>
        </div>
        {err.venueFee && <p className="mt-2 text-xs text-red-600">{err.venueFee}</p>}

        <div className="mt-4">
          <label className={label}>How the customer sees it</label>
          <select name="venueFeeItemized" defaultValue={v.venueFeeItemized ? "1" : "0"} className={input}>
            <option value="1">Its own line in the price breakdown</option>
            <option value="0">Not in the price — explained by a notice</option>
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            A line in the breakdown is exact, but it raises the Total the customer
            sees. Leaving it out keeps the Total to money that moves through us —
            add a <span className="font-medium">Notice</span> field to the tour so
            they still know to bring cash.
            <span className="mt-1 block font-medium text-amber-700 dark:text-amber-500">
              Leaving it out also removes it from the check-in manifest. Only use
              that if the venue takes the admission itself — if your staff collect
              it, keep the line or they&rsquo;ll come up short.
            </span>
          </p>
        </div>
      </section>

      {err.form && <p className="text-sm text-red-600">{err.form}</p>}
      <div className="flex items-center gap-3">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
        {state?.ok && <span className="text-sm font-medium text-emerald-600">Saved</span>}
      </div>
    </form>
  );
}
