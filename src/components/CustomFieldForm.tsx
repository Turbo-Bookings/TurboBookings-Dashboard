"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { CustomFieldFormState } from "@/lib/actions/customFields";

const input =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

const KINDS = [
  { value: "text", label: "Text input" },
  { value: "checkbox", label: "Checkbox (acknowledgment)" },
  { value: "dropdown", label: "Dropdown (choose one)" },
  { value: "quantity", label: "Quantity add-on (priced)" },
];

export function CustomFieldForm({
  action,
  cancelHref,
  initial,
  submitLabel,
}: {
  action: (prev: CustomFieldFormState | null, formData: FormData) => Promise<CustomFieldFormState>;
  cancelHref: string;
  initial?: CustomFieldFormState["values"];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const v = state?.values ?? initial;
  const err = state?.errors ?? {};
  const [kind, setKind] = useState(v?.kind ?? "text");

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div>
        <label className="block text-sm font-medium">Type</label>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium">Label</label>
        <input name="label" defaultValue={v?.label ?? ""} className={input} placeholder="e.g. I acknowledge the $100 security hold" />
        {err.label && <p className="mt-1 text-xs text-red-600">{err.label}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">Help text (optional)</label>
        <textarea
          name="helpText"
          defaultValue={v?.helpText ?? ""}
          rows={3}
          className={input}
          placeholder={"Add extra guidance for the customer.\nLine breaks are preserved."}
        />
      </div>

      {kind === "dropdown" && (
        <div>
          <label className="block text-sm font-medium">Options (one per line)</label>
          <textarea name="optionsText" defaultValue={v?.optionsText ?? ""} rows={4} className={input} placeholder={"Small\nMedium\nLarge"} />
          {err.options && <p className="mt-1 text-xs text-red-600">{err.options}</p>}
        </div>
      )}

      {kind === "quantity" && (
        <div>
          <label className="block text-sm font-medium">Price per unit ($, optional)</label>
          <input name="priceDollars" defaultValue={v?.priceDollars ?? ""} className={`${input} w-40`} inputMode="decimal" placeholder="25" />
          {err.price && <p className="mt-1 text-xs text-red-600">{err.price}</p>}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="required" defaultChecked={v?.required ?? false} className="h-4 w-4" />
        Required
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
