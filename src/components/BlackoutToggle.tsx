"use client";

import { useState, useTransition } from "react";
import { addBlackout, removeBlackout } from "@/lib/actions/blackouts";

type Props = {
  slug: string;
  dateKey: string;
  /** id of an existing location-wide blackout covering this day, if any */
  existingBlackoutId: string | null;
};

export function BlackoutToggle({ slug, dateKey, existingBlackoutId }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function blackout() {
    const fd = new FormData();
    fd.set("startDate", dateKey);
    setError(null);
    startTransition(async () => {
      const r = await addBlackout(slug, fd);
      if (!r.ok) setError(r.error ?? "Failed");
    });
  }

  function unblock() {
    if (!existingBlackoutId) return;
    setError(null);
    startTransition(async () => {
      const r = await removeBlackout(slug, existingBlackoutId);
      if (!r.ok) setError(r.error ?? "Failed");
    });
  }

  return (
    <div className="flex items-center gap-2">
      {existingBlackoutId ? (
        <button
          type="button"
          disabled={pending}
          onClick={unblock}
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          Remove blackout
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={blackout}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Black out this day
        </button>
      )}
      {error && (
        <span className="text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
