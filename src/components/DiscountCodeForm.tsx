"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { DiscountFormState } from "@/lib/actions/discountCodes";

const EMPTY: DiscountFormState["values"] = {
  code: "",
  amountKind: "fixed",
  amount: "",
  maxUses: "",
  active: true,
  validFrom: "",
  validUntil: "",
  appliesToItemIds: [],
};

const input =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function DiscountCodeForm({
  action,
  cancelHref,
  items,
  initial,
  submitLabel,
}: {
  action: (prev: DiscountFormState | null, formData: FormData) => Promise<DiscountFormState>;
  cancelHref: string;
  items: { id: string; name: string }[];
  initial?: DiscountFormState["values"];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial ?? EMPTY;
  const err = state?.errors ?? {};

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div>
        <label className="block text-sm font-medium">Code</label>
        <input name="code" defaultValue={v.code} className={input} placeholder="TAKEOVER20" />
        {err.code && <p className="mt-1 text-xs text-red-600">{err.code}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Type</label>
          <select name="amountKind" defaultValue={v.amountKind} className={input}>
            <option value="fixed">Fixed ($ off)</option>
            <option value="percent">Percent (% off)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Amount</label>
          <input name="amount" defaultValue={v.amount} className={input} placeholder="20" inputMode="decimal" />
          {err.amount && <p className="mt-1 text-xs text-red-600">{err.amount}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Max uses</label>
          <input name="maxUses" defaultValue={v.maxUses} className={input} placeholder="Unlimited" inputMode="numeric" />
          {err.maxUses && <p className="mt-1 text-xs text-red-600">{err.maxUses}</p>}
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={v.active} className="h-4 w-4" />
            Active
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium">Valid from</label>
          <input type="date" name="validFrom" defaultValue={v.validFrom} className={input} />
        </div>
        <div>
          <label className="block text-sm font-medium">Valid until</label>
          <input type="date" name="validUntil" defaultValue={v.validUntil} className={input} />
          {err.validUntil && <p className="mt-1 text-xs text-red-600">{err.validUntil}</p>}
        </div>
      </div>

      {items.length > 0 && (
        <div>
          <label className="block text-sm font-medium">Applies to tours</label>
          <p className="text-xs text-zinc-500">Leave all unchecked to apply to every tour.</p>
          <div className="mt-1 space-y-1">
            {items.map((i) => (
              <label key={i.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="appliesToItemIds"
                  value={i.id}
                  defaultChecked={v.appliesToItemIds.includes(i.id)}
                  className="h-4 w-4"
                />
                {i.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {err.form && <p className="text-sm text-red-600">{err.form}</p>}

      <div className="flex gap-2">
        <button
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link
          href={cancelHref}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
