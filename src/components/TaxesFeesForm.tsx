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
