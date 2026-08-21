"use client";

import { useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { moveItem } from "@/lib/actions/items";

/**
 * Up/down rather than drag-and-drop.
 *
 * Deliberate: this list is read and edited on phones as often as desktops, and
 * drag-and-drop on touch fights the page scroll. Two buttons work with a
 * keyboard and a screen reader for free, and there is no half-dropped state to
 * recover from.
 */
export function MoveTourButtons({
  slug,
  id,
  name,
  isFirst,
  isLast,
}: {
  slug: string;
  id: string;
  name: string;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [pending, start] = useTransition();
  const move = (direction: "up" | "down") =>
    start(async () => {
      await moveItem(slug, id, direction);
    });

  const base =
    "inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="flex shrink-0 flex-col gap-1" aria-label={`Reorder ${name}`}>
      <button
        type="button"
        onClick={() => move("up")}
        disabled={isFirst || pending}
        aria-label={`Move ${name} up`}
        title="Move up"
        className={base}
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => move("down")}
        disabled={isLast || pending}
        aria-label={`Move ${name} down`}
        title="Move down"
        className={base}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
    </div>
  );
}
