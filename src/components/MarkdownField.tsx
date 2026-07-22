"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bold, Heading, Italic, Link2, List } from "lucide-react";

// Markdown editor: a textarea with a formatting toolbar (inserts Markdown at the
// cursor) + a live preview rendered with the SAME react-markdown pipeline the
// customer tour page uses. Keeps `name` so the server action reads it unchanged.
export function MarkdownField({
  name,
  label,
  defaultValue,
  error,
  rows = 8,
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string;
  error?: string;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(defaultValue);
  const [showPreview, setShowPreview] = useState(true);

  // Wrap the current selection with before/after, or insert at the cursor.
  function surround(before: string, after = "", placeholderText = "") {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholderText;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    setValue(next);
    // Restore focus + place cursor inside the inserted text.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + before.length;
      el.setSelectionRange(pos, pos + selected.length);
    });
  }

  // Prefix each selected line (or the current line) with `prefix`.
  function prefixLines(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const block = value.slice(lineStart, end);
    const prefixed = block
      .split("\n")
      .map((l) => (l.startsWith(prefix) ? l : prefix + l))
      .join("\n");
    const next = value.slice(0, lineStart) + prefixed + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + prefixed.length);
    });
  }

  const btn =
    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label} <span className="text-xs font-normal text-zinc-400">(optional)</span>
      </label>

      <div className="rounded-md border border-zinc-300 dark:border-zinc-700">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 px-1.5 py-1 dark:border-zinc-800">
          <button type="button" className={btn} onClick={() => surround("**", "**", "bold text")} title="Bold">
            <Bold className="h-3.5 w-3.5" /> Bold
          </button>
          <button type="button" className={btn} onClick={() => surround("_", "_", "italic text")} title="Italic">
            <Italic className="h-3.5 w-3.5" /> Italic
          </button>
          <button type="button" className={btn} onClick={() => prefixLines("## ")} title="Heading">
            <Heading className="h-3.5 w-3.5" /> Heading
          </button>
          <button type="button" className={btn} onClick={() => prefixLines("- ")} title="Bullet list">
            <List className="h-3.5 w-3.5" /> Bullet
          </button>
          <button type="button" className={btn} onClick={() => surround("[", "](https://)", "link text")} title="Link">
            <Link2 className="h-3.5 w-3.5" /> Link
          </button>
          <button
            type="button"
            className={`${btn} ml-auto`}
            onClick={() => setShowPreview((p) => !p)}
          >
            {showPreview ? "Hide preview" : "Show preview"}
          </button>
        </div>

        <div className={showPreview ? "grid gap-px bg-zinc-200 dark:bg-zinc-800 md:grid-cols-2" : ""}>
          <textarea
            ref={ref}
            id={name}
            name={name}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={rows}
            placeholder={placeholder ?? "Describe the tour. Use the toolbar for **bold**, ## headings, and bullet lists."}
            className="block w-full resize-y bg-white px-3 py-2 font-mono text-sm shadow-sm placeholder:text-zinc-400 focus:outline-none dark:bg-zinc-900"
            aria-invalid={error ? true : undefined}
          />
          {showPreview && (
            <div className="min-h-[8rem] overflow-auto bg-white px-3 py-2 dark:bg-zinc-900">
              {value.trim() ? (
                <div className="space-y-2 text-sm leading-relaxed text-zinc-800 [&_a]:text-blue-600 [&_a]:underline [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-semibold dark:text-zinc-200">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-xs text-zinc-400">Preview appears here.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
