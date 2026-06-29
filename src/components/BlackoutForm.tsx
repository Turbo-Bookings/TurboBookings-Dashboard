"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addBlackout } from "@/lib/actions/blackouts";

const input =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function BlackoutForm({
  slug,
  items,
}: {
  slug: string;
  items: { id: string; name: string }[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    startTransition(async () => {
      const r = await addBlackout(slug, fd);
      if (!r.ok) setError(r.error ?? "Failed");
      else {
        formRef.current?.reset();
        router.refresh();
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Start date</span>
          <input type="date" name="startDate" required className={`w-full ${input}`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">End date <span className="text-zinc-400">(optional)</span></span>
          <input type="date" name="endDate" className={`w-full ${input}`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Tour</span>
          <select name="itemId" defaultValue="" className={`w-full ${input}`}>
            <option value="">All tours</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Reason <span className="text-zinc-400">(optional)</span></span>
          <input name="reason" placeholder="Christmas" className={`w-full ${input}`} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          disabled={pending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add blackout"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
        <span className="text-xs text-zinc-500">Leave the tour as “All tours” to black out the whole location.</span>
      </div>
    </form>
  );
}
