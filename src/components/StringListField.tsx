"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

// Repeatable one-line-per-item list editor (Highlights / What's included / What
// to bring). Serializes to a hidden input as JSON — parsed server-side by
// parseStringList in lib/actions/items.ts (same pattern as PricingMatrixEditor).
export function StringListField({
  name,
  label,
  defaultValue,
  placeholder,
  max = 15,
}: {
  name: string;
  label: string;
  defaultValue: string[];
  placeholder?: string;
  max?: number;
}) {
  const [items, setItems] = useState<string[]>(
    defaultValue.length ? defaultValue : [""],
  );

  function update(i: number, v: string) {
    setItems((prev) => prev.map((x, j) => (j === i ? v : x)));
  }
  function add() {
    setItems((prev) => (prev.length >= max ? prev : [...prev, ""]));
  }
  function remove(i: number) {
    setItems((prev) => {
      const next = prev.filter((_, j) => j !== i);
      return next.length ? next : [""];
    });
  }

  const cleaned = items.map((s) => s.trim()).filter(Boolean);

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label} <span className="text-xs font-normal text-zinc-400">(optional)</span>
      </span>
      <input type="hidden" name={name} value={JSON.stringify(cleaned)} />

      <div className="space-y-1.5">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={v}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              maxLength={160}
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button type="button" onClick={() => remove(i)} className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" aria-label="Remove">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {items.length < max && (
        <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400">
          <Plus className="h-3.5 w-3.5" /> Add item
        </button>
      )}
    </div>
  );
}
