"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import type { CustomerTypeFormState } from "@/lib/actions/customerTypes";

type Action = (
  prev: CustomerTypeFormState | null,
  formData: FormData,
) => Promise<CustomerTypeFormState>;

type Props = {
  action: Action;
  cancelHref: string;
  initialValues?: CustomerTypeFormState["values"];
  showArchivedField?: boolean;
  submitLabel: string;
};

const EMPTY: CustomerTypeFormState["values"] = {
  singular: "",
  plural: "",
  sku: "",
  note: "",
  minAge: "",
  ticketColor: "",
  excludePricingModifiers: false,
  archived: false,
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function CustomerTypeForm({
  action,
  cancelHref,
  initialValues,
  showArchivedField,
  submitLabel,
}: Props) {
  const [state, formAction] = useActionState<CustomerTypeFormState | null, FormData>(
    action,
    null,
  );

  // Show the user's typed values after a failed submit; otherwise use the
  // initialValues (edit page) or EMPTY (new page).
  const values =
    state && !state.ok ? state.values : (initialValues ?? EMPTY);
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Field
          label="Singular label"
          name="singular"
          defaultValue={values.singular}
          placeholder="Single Rider ATV"
          hint="What appears on the booking form for one of this type"
          error={errors.singular}
          autoFocus
        />
        <Field
          label="Plural label"
          name="plural"
          defaultValue={values.plural}
          placeholder="Single Rider ATVs"
          hint="Used when quantity > 1"
          error={errors.plural}
        />
        <Field
          label="SKU"
          name="sku"
          defaultValue={values.sku}
          placeholder="SR_ATV"
          hint="Internal code (optional)"
          optional
          error={errors.sku}
        />
        <Field
          label="Minimum age"
          name="minAge"
          defaultValue={values.minAge}
          placeholder="16"
          hint="Years; leave blank for no minimum"
          optional
          error={errors.minAge}
        />
        <div className="space-y-1.5">
          <label
            htmlFor="ticketColor"
            className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Ticket color
            <span className="text-xs font-normal text-zinc-400">(optional)</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              id="ticketColor"
              name="ticketColor"
              defaultValue={values.ticketColor || "#0a0a0a"}
              className="h-10 w-14 cursor-pointer rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"
              aria-describedby={
                errors.ticketColor ? "ticketColor-error" : "ticketColor-hint"
              }
            />
            <span className="font-mono text-xs text-zinc-500">
              {values.ticketColor || "—"}
            </span>
          </div>
          {errors.ticketColor ? (
            <p
              id="ticketColor-error"
              className="text-xs font-medium text-red-600 dark:text-red-400"
            >
              {errors.ticketColor}
            </p>
          ) : (
            <p id="ticketColor-hint" className="text-xs text-zinc-500">
              Visual differentiator on tickets + manifest
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="note"
          className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Operator note
          <span className="text-xs font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="note"
          name="note"
          defaultValue={values.note}
          rows={3}
          placeholder="Free-text note visible to operators on the manifest"
          className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="excludePricingModifiers"
            defaultChecked={values.excludePricingModifiers}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Exclude from pricing modifiers
            </span>
            <p className="mt-0.5 text-xs text-zinc-500">
              When checked, discounts, campaigns, and custom-field pricing don&apos;t
              apply to this customer type. Useful for comp, affiliate, or group-rate
              types.
            </p>
          </span>
        </label>

        {showArchivedField && (
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={values.archived}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Archived
              </span>
              <p className="mt-0.5 text-xs text-zinc-500">
                Hidden from new tour configurations. Existing bookings + items
                that already reference this type continue to work.
              </p>
            </span>
          </label>
        )}
      </div>

      {errors.form && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errors.form}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <SubmitButton label={submitLabel} />
        <Link
          href={cancelHref}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
