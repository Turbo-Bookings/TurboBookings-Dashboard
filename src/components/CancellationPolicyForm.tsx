"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { PolicyFormState } from "@/lib/actions/cancellationPolicies";

type RuleRow = { hours: string; pct: string };

const input =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function CancellationPolicyForm({
  action,
  cancelHref,
  initial,
  submitLabel,
}: {
  action: (prev: PolicyFormState | null, formData: FormData) => Promise<PolicyFormState>;
  cancelHref: string;
  initial?: { name: string; gracePeriodMinutes: string; isDefault: boolean; rules: RuleRow[] };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values;
  const err = state?.errors ?? {};
  const [rules, setRules] = useState<RuleRow[]>(
    v
      ? v.ruleHours.map((h, i) => ({ hours: h, pct: v.rulePct[i] ?? "" }))
      : initial?.rules ?? [{ hours: "24", pct: "100" }],
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <div>
        <label className="block text-sm font-medium">Policy name</label>
        <input name="name" defaultValue={v?.name ?? initial?.name ?? ""} className={`mt-1 w-full ${input}`} placeholder="Standard 24-hour" />
        {err.name && <p className="mt-1 text-xs text-red-600">{err.name}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">Grace period (minutes after booking)</label>
        <input name="gracePeriodMinutes" defaultValue={v?.gracePeriodMinutes ?? initial?.gracePeriodMinutes ?? "0"} className={`mt-1 w-40 ${input}`} inputMode="numeric" />
        <p className="mt-1 text-xs text-zinc-500">Full refund if cancelled within this many minutes of booking.</p>
        {err.grace && <p className="mt-1 text-xs text-red-600">{err.grace}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">Refund rules</label>
        <p className="text-xs text-zinc-500">If cancelled at least N hours before start, refund X%. Highest matching rule wins.</p>
        <div className="mt-2 space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-zinc-500">≥</span>
              <input
                name="ruleHours"
                value={r.hours}
                onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))}
                className={`w-20 ${input}`}
                inputMode="numeric"
              />
              <span className="text-sm text-zinc-500">hours before → refund</span>
              <input
                name="rulePct"
                value={r.pct}
                onChange={(e) => setRules((rs) => rs.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                className={`w-20 ${input}`}
                inputMode="numeric"
              />
              <span className="text-sm text-zinc-500">%</span>
              <button type="button" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="text-sm text-red-600 hover:underline">
                remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRules((rs) => [...rs, { hours: "", pct: "" }])} className="mt-2 text-sm text-blue-600 hover:underline">
          + Add rule
        </button>
        {err.rules && <p className="mt-1 text-xs text-red-600">{err.rules}</p>}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isDefault" defaultChecked={v?.isDefault ?? initial?.isDefault ?? false} className="h-4 w-4" />
        Make this the location&apos;s default policy
      </label>

      {err.form && <p className="text-sm text-red-600">{err.form}</p>}

      <div className="flex gap-2">
        <button disabled={pending} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href={cancelHref} className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Cancel
        </Link>
      </div>
    </form>
  );
}
