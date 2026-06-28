"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDiscountCode } from "@/lib/actions/discountCodes";

export function DeleteDiscountButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (window.confirm("Delete this discount code?"))
          startTransition(async () => {
            await deleteDiscountCode(slug, id);
            router.push(`/locations/${slug}/catalog/discounts`);
          });
      }}
      className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      Delete
    </button>
  );
}
