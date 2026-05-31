"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import type { ResourceFormState } from "@/lib/actions/resources";

type Action = (
  prev: ResourceFormState | null,
  formData: FormData,
) => Promise<ResourceFormState>;

type Props = {
  action: Action;
  cancelHref: string;
  initialValues?: ResourceFormState["values"];
  submitLabel: string;
};

const EMPTY: ResourceFormState["values"] = {
  name: "",
  maxConcurrentUses: "",
  outOfServiceCount: "0",
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

export function ResourceForm({
  action,
  cancelHref,
  initialValues,
  submitLabel,
}: Props) {
  const [state, formAction] = useActionState<ResourceFormState | null, FormData>(
    action,
    null,
  );

  const values =
    state && !state.ok ? state.values : (initialValues ?? EMPTY);
  const errors = state?.errors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      <Field
        label="Name"
        name="name"
        defaultValue={values.name}
        placeholder="ATV"
        hint="Plural noun; shows up in tour configuration as the resource a customer-type consumes"
        error={errors.name}
        autoFocus
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Field
          label="Max concurrent uses"
          name="maxConcurrentUses"
          defaultValue={values.maxConcurrentUses}
          placeholder="12"
          hint="How many of this resource exist in total"
          error={errors.maxConcurrentUses}
        />
        <Field
          label="Out of service"
          name="outOfServiceCount"
          defaultValue={values.outOfServiceCount}
          placeholder="0"
          hint="Units temporarily unavailable (maintenance, damage)"
          error={errors.outOfServiceCount}
        />
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
