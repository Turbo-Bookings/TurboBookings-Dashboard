"use client";

import { useState, useTransition } from "react";
import {
  deleteSlot,
  setSlotCapacity,
  setSlotStatus,
} from "@/lib/actions/availability";

type Props = {
  slug: string;
  id: string;
  timeLabel: string;
  itemName: string;
  isFixed: boolean;
  status: "on" | "off" | "auto";
  capacityValue: string;
  capacityHint: string;
};

const ctrlCls =
  "rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900";

export function SlotControls({
  slug,
  id,
  timeLabel,
  itemName,
  isFixed,
  status,
  capacityValue,
  capacityHint,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cap, setCap] = useState(capacityValue);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
      <span className="w-32 shrink-0 font-mono text-sm text-zinc-700 dark:text-zinc-300">
        {timeLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100">
        {itemName}
      </span>

      <select
        value={status}
        disabled={pending}
        onChange={(e) => run(() => setSlotStatus(slug, id, e.target.value))}
        className={ctrlCls}
        aria-label="Online booking status"
      >
        <option value="auto">auto</option>
        <option value="on">on</option>
        <option value="off">off</option>
      </select>

      {isFixed && (
        <input
          type="number"
          min={1}
          value={cap}
          placeholder={capacityHint}
          disabled={pending}
          onChange={(e) => setCap(e.target.value)}
          onBlur={() => {
            if (cap !== capacityValue) run(() => setSlotCapacity(slug, id, cap));
          }}
          className={`${ctrlCls} w-20`}
          aria-label="Capacity override"
        />
      )}

      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => deleteSlot(slug, id))}
        className="text-xs font-medium text-zinc-500 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
      >
        Delete
      </button>

      {error && (
        <span className="w-full text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
