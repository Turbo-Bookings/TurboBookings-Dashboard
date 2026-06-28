"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import type { ItemFormState } from "@/lib/actions/items";

type Action = (
  prev: ItemFormState | null,
  formData: FormData,
) => Promise<ItemFormState>;

type Props = {
  action: Action;
  cancelHref: string;
  initialValues?: ItemFormState["values"];
  submitLabel: string;
};

const EMPTY: ItemFormState["values"] = {
  name: "",
  descriptionMd: "",
  defaultDurationMinutes: "60",
  capacityMode: "resource_based",
  bookableOnline: true,
  listingVisible: true,
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

export function ItemForm({
  action,
  cancelHref,
  initialValues,
  submitLabel,
}: Props) {
  const [state, formAction] = useActionState<ItemFormState | null, FormData>(
    action,
    null,
  );

  const values = state && !state.ok ? state.values : (initialValues ?? EMPTY);
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <Field
        label="Name"
        name="name"
        defaultValue={values.name}
        placeholder="1-Hour ATV Tour"
        hint="Shown on the customer-facing tour list and booking confirmation"
        error={errors.name}
        autoFocus
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Field
          label="Default duration (minutes)"
          name="defaultDurationMinutes"
          defaultValue={values.defaultDurationMinutes}
          placeholder="60"
          hint="Drives default end time when a slot is created"
          error={errors.defaultDurationMinutes}
        />
      </div>

      <div className="space-y-2">
        <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Capacity
        </span>
        <p className="text-xs text-zinc-500">
          How this tour&apos;s bookable capacity is determined.
        </p>
        <div className="space-y-2">
          <label className="flex items-start gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <input
              type="radio"
              name="capacityMode"
              value="resource_based"
              defaultChecked={values.capacityMode !== "fixed"}
              className="mt-0.5 h-4 w-4 border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                From resources
              </span>
              <p className="mt-0.5 text-xs text-zinc-500">
                Capacity is limited by this tour&apos;s resource pools (ATVs,
                UTVs…) and what each customer type consumes — set on the tour&apos;s
                Resources tab. Recommended for equipment-based tours.
              </p>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <input
              type="radio"
              name="capacityMode"
              value="fixed"
              defaultChecked={values.capacityMode === "fixed"}
              className="mt-0.5 h-4 w-4 border-zinc-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                Fixed number of spots
              </span>
              <p className="mt-0.5 text-xs text-zinc-500">
                A flat capacity per time slot, entered on each schedule. Use for
                tours not tied to a physical resource.
              </p>
            </span>
          </label>
        </div>
        {errors.capacityMode && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            {errors.capacityMode}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="descriptionMd"
          className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Description (markdown)
          <span className="text-xs font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="descriptionMd"
          name="descriptionMd"
          defaultValue={values.descriptionMd}
          rows={8}
          placeholder="What's included, who it's for, what to bring. Supports basic markdown — **bold**, _italic_, lists."
          className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          aria-invalid={errors.descriptionMd ? true : undefined}
        />
        {errors.descriptionMd && (
          <p className="text-xs font-medium text-red-600 dark:text-red-400">
            {errors.descriptionMd}
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="bookableOnline"
            defaultChecked={values.bookableOnline}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Bookable online
            </span>
            <p className="mt-0.5 text-xs text-zinc-500">
              When unchecked, customers can&apos;t book through the public flow.
              Operators can still create bookings manually (phone, walk-up).
            </p>
          </span>
        </label>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="listingVisible"
            defaultChecked={values.listingVisible}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              Listed on tour list
            </span>
            <p className="mt-0.5 text-xs text-zinc-500">
              When unchecked, the tour is hidden from browse pages but
              still reachable via direct link. Combined with the toggle
              above for full archival.
            </p>
          </span>
        </label>
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
