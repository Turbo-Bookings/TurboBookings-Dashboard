"use client";

import { useRouter } from "next/navigation";
import { CalendarSearch } from "lucide-react";

/**
 * Jump straight to a date.
 *
 * The bookings page and the manifest could only be moved a day at a time with prev/next arrows.
 * Getting to a Saturday three weeks out meant twenty-one clicks and a full page load each, which is
 * why nobody looked ahead.
 *
 * A native `<input type="date">` on purpose. It gets the platform's own calendar — the one people
 * already know, keyboard-navigable, correctly localised, and free on mobile where it opens the OS
 * picker — and it needs no dependency and no popover state to get wrong. The same control is already
 * used on four other forms in this app, so it also looks like the rest of the product.
 *
 * The arrows stay. Stepping one day is still the common move; this is for the uncommon one.
 *
 * ⚠️ The URL is built HERE from a base path and plain params, rather than taking an `hrefFor`
 * callback from the caller. A Server Component cannot hand a function to a Client Component — props
 * cross that boundary by serialization — and doing it took the whole bookings page down with
 * "Functions cannot be passed directly to Client Components". Everything below must stay
 * serializable: strings, numbers, plain objects.
 */
export function DateJump({
  value,
  basePath,
  params,
  label = "Jump to date",
}: {
  /** Currently shown day, `YYYY-MM-DD`. */
  value: string;
  /** Path to navigate to, e.g. `/locations/htown/bookings`. */
  basePath: string;
  /** Query params to preserve alongside the new date (view, filters). */
  params?: Record<string, string>;
  label?: string;
}) {
  const router = useRouter();
  return (
    <label
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      title={label}
    >
      <CalendarSearch className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        type="date"
        value={value}
        // Navigate on change rather than behind a "Go" button: picking a date IS the intent, and an
        // extra confirming click on a control that already closed itself reads as a bug.
        onChange={(e) => {
          const next = e.target.value;
          // Cleared, or a partially-typed date. Do nothing rather than navigate somewhere arbitrary.
          if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
          const q = new URLSearchParams({ ...(params ?? {}), date: next });
          router.push(`${basePath}?${q.toString()}`);
        }}
        className="bg-transparent text-sm outline-none"
      />
    </label>
  );
}
