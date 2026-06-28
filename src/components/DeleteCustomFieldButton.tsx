"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCustomField } from "@/lib/actions/customFields";

export function DeleteCustomFieldButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Remove this custom field?"))
          startTransition(async () => {
            await deleteCustomField(slug, id);
            router.push(`/locations/${slug}/catalog/custom-fields`);
          });
      }}
      className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      Delete
    </button>
  );
}
