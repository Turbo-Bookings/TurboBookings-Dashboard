"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePolicy } from "@/lib/actions/cancellationPolicies";

export function DeletePolicyButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Delete this policy?"))
            startTransition(async () => {
              const r = await deletePolicy(slug, id);
              if (!r.ok) setError(r.error ?? "Failed");
              else router.push(`/locations/${slug}/catalog/cancellation`);
            });
        }}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        Delete
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
