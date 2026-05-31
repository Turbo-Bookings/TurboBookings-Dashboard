"use client";

import { useFormStatus } from "react-dom";
import type { CustomerType } from "@/lib/db/schema";

type Props = {
  available: CustomerType[];
  addAction: (formData: FormData) => Promise<void>;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {pending ? "Adding…" : "+ Add"}
    </button>
  );
}

export function AddCustomerTypeForm({ available, addAction }: Props) {
  if (available.length === 0) {
    return (
      <p className="text-xs text-zinc-500">
        Every active customer type at this location is already on this tour.
      </p>
    );
  }

  return (
    <form action={addAction} className="flex items-center gap-2">
      <select
        name="customerTypeId"
        className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
        defaultValue={available[0]?.id ?? ""}
      >
        {available.map((ct) => (
          <option key={ct.id} value={ct.id}>
            {ct.singular}
          </option>
        ))}
      </select>
      <SubmitButton />
    </form>
  );
}
