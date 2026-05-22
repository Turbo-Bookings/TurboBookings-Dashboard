"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import { createLocation } from "@/lib/actions/locations";

// Initial state is the same shape useActionState will pass back on every
// validation failure — no errors, empty values. Typed as the ok:false branch
// so the renderer can read .values / .errors without narrowing every time.
const INITIAL_STATE = {
  ok: false as const,
  errors: {} as Record<string, string>,
  values: { slug: "", city: "", apex: "", displayName: "" },
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {pending ? "Creating…" : "Create location"}
    </button>
  );
}

export function NewLocationForm() {
  const [state, formAction] = useActionState(createLocation, INITIAL_STATE);
  // On success the action redirects, so we'll never see ok:true rendered.
  // Defensive default keeps TS happy if that ever changes.
  const values = "values" in state ? state.values : INITIAL_STATE.values;
  const errors = "errors" in state ? state.errors : {};

  return (
    <form action={formAction} className="space-y-5">
      <Field
        label="Slug"
        name="slug"
        defaultValue={values.slug}
        error={errors.slug}
        hint="Short stable identifier — used in URLs and as the GitHub repo suffix. Examples: miami, htown, phoenix."
        placeholder="e.g. phoenix"
        autoFocus
      />
      <Field
        label="City"
        name="city"
        defaultValue={values.city}
        error={errors.city}
        hint="Used in the master list and as the location label across the site."
        placeholder="e.g. Phoenix"
      />
      <Field
        label="Apex domain"
        name="apex"
        defaultValue={values.apex}
        error={errors.apex}
        hint="The production domain — no protocol, no www. We'll auto-generate the canonical URL from this."
        placeholder="e.g. phoenixatvrentals.com"
      />
      <Field
        label="Brand display name"
        name="displayName"
        defaultValue={values.displayName}
        error={errors.displayName}
        hint="What users see — e.g. 'Phoenix ATV Rentals'. Can be filled in later."
        placeholder="e.g. Phoenix ATV Rentals"
        optional
      />

      {errors.form && (
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          {errors.form}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Link
          href="/"
          className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Cancel
        </Link>
        <SubmitButton />
      </div>
    </form>
  );
}
