"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import { MarkdownField } from "@/components/MarkdownField";
import { StringListField } from "@/components/StringListField";
import { FaqEditor } from "@/components/FaqEditor";
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
  highlights: [],
  included: [],
  whatToBring: [],
  minAge: "",
  languages: [],
  groupSizeLabel: "",
  faqs: [],
  cancellationNotesMd: "",
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

      <MarkdownField
        name="descriptionMd"
        label="Details"
        defaultValue={values.descriptionMd}
        error={errors.descriptionMd}
        placeholder="Describe the tour — the ride, the terrain, who it's for. Use the toolbar for **bold**, ## headings, and bullet lists."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <StringListField
          name="highlights"
          label="Highlights"
          defaultValue={values.highlights}
          placeholder="e.g. Beginner-friendly, no experience needed"
        />
        <StringListField
          name="included"
          label="What's included"
          defaultValue={values.included}
          placeholder="e.g. Helmet + safety briefing"
        />
        <StringListField
          name="whatToBring"
          label="What to bring"
          defaultValue={values.whatToBring}
          placeholder="e.g. Closed-toe shoes"
        />
      </div>

      {/* Overview key-values (shown alongside Duration on the tour page) */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Field
          label="Minimum age"
          name="minAge"
          defaultValue={values.minAge}
          placeholder="e.g. 3"
          hint="Shown as “Age 3+”. Blank for no minimum."
          error={errors.minAge}
        />
        <Field
          label="Group size"
          name="groupSizeLabel"
          defaultValue={values.groupSizeLabel}
          placeholder="e.g. Up to 65 ATVs"
          hint="Freeform label shown in Overview."
        />
        <StringListField
          name="languages"
          label="Offered in"
          defaultValue={values.languages}
          placeholder="e.g. English"
        />
      </div>

      <FaqEditor name="faqs" defaultValue={values.faqs} />

      <MarkdownField
        name="cancellationNotesMd"
        label="Cancellation notes"
        defaultValue={values.cancellationNotesMd}
        rows={4}
        placeholder="Customer-facing cancellation policy — e.g. **Full refund** with 48 hours notice."
      />

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
