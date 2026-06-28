"use client";

import { useState, useTransition } from "react";
import { setFieldAttachments } from "@/lib/actions/customFields";

export function AttachFieldControl({
  slug,
  fieldId,
  items,
  attached,
}: {
  slug: string;
  fieldId: string;
  items: { id: string; name: string }[];
  attached: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(attached));
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSaved(false);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await setFieldAttachments(slug, fieldId, [...selected]);
      if (!r.ok) setError(r.error ?? "Failed");
      else setSaved(true);
    });
  }

  return (
    <div className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-medium">Show on these tours</h3>
      <p className="text-xs text-zinc-500">Attached at the whole-booking level (shown once per booking).</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">No tours yet.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {items.map((i) => (
            <label key={i.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} className="h-4 w-4" />
              {i.name}
            </label>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {pending ? "Saving…" : "Save attachments"}
        </button>
        {saved && <span className="text-xs text-emerald-600">Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
