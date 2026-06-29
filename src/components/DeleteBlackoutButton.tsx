"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeBlackout } from "@/lib/actions/blackouts";

export function DeleteBlackoutButton({ slug, id }: { slug: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await removeBlackout(slug, id);
            if (!r.ok) setError(r.error ?? "Failed");
            else router.refresh();
          })
        }
        className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
