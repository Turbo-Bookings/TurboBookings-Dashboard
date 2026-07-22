"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

type Faq = { q: string; a: string };

// Repeatable question/answer editor → hidden JSON input, parsed server-side by
// parseFaqs in lib/actions/items.ts.
export function FaqEditor({
  name,
  defaultValue,
  max = 20,
}: {
  name: string;
  defaultValue: Faq[];
  max?: number;
}) {
  const [faqs, setFaqs] = useState<Faq[]>(
    defaultValue.length ? defaultValue : [{ q: "", a: "" }],
  );

  function update(i: number, patch: Partial<Faq>) {
    setFaqs((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }
  function add() {
    setFaqs((prev) => (prev.length >= max ? prev : [...prev, { q: "", a: "" }]));
  }
  function remove(i: number) {
    setFaqs((prev) => {
      const next = prev.filter((_, j) => j !== i);
      return next.length ? next : [{ q: "", a: "" }];
    });
  }

  const cleaned = faqs
    .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
    .filter((f) => f.q && f.a);

  const input =
    "block w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        FAQs <span className="text-xs font-normal text-zinc-400">(optional)</span>
      </span>
      <input type="hidden" name={name} value={JSON.stringify(cleaned)} />

      <div className="space-y-3">
        {faqs.map((f, i) => (
          <div key={i} className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800">
            <div className="flex items-start gap-1.5">
              <div className="flex-1 space-y-1.5">
                <input
                  value={f.q}
                  onChange={(e) => update(i, { q: e.target.value })}
                  placeholder="Question — e.g. Do I need experience?"
                  maxLength={200}
                  className={input}
                />
                <textarea
                  value={f.a}
                  onChange={(e) => update(i, { a: e.target.value })}
                  placeholder="Answer"
                  rows={2}
                  maxLength={1000}
                  className={input}
                />
              </div>
              <button type="button" onClick={() => remove(i)} className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" aria-label="Remove FAQ">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {faqs.length < max && (
        <button type="button" onClick={add} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400">
          <Plus className="h-3.5 w-3.5" /> Add FAQ
        </button>
      )}
    </div>
  );
}
