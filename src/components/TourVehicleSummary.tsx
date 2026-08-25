import type { GridSlot } from "@/lib/data/bookings";

/**
 * How many vehicles are sold on each tour, across the days on screen.
 *
 * The grid shows this slot by slot, which answers "is the 7pm full" but not "how many machines do we
 * need out today" — and the second question is the one the yard is loaded against. Counting it meant
 * reading down a column of cards and adding up.
 *
 * Folded from the slots already fetched for the grid, so it costs nothing: `gridForDate` returns
 * `booked` per slot, which is `Σ booking_lines.quantity` for active bookings on it.
 *
 * Vehicles, not people. A Double Rider ATV is one unit carrying two riders, and nothing in the
 * schema reliably converts between them today.
 */
export function TourVehicleSummary({ slots }: { slots: GridSlot[] }) {
  const byTour = new Map<string, number>();
  for (const s of slots) {
    if (s.booked <= 0) continue;
    byTour.set(s.itemName, (byTour.get(s.itemName) ?? 0) + s.booked);
  }
  if (byTour.size === 0) return null;

  const rows = [...byTour].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      {rows.map(([name, n]) => (
        <span key={name} className="inline-flex items-baseline gap-1.5">
          <span className="font-semibold tabular-nums">{n}</span>
          <span className="text-zinc-600 dark:text-zinc-300">{name}</span>
        </span>
      ))}
      {rows.length > 1 && (
        <span className="ml-auto inline-flex items-baseline gap-1.5 border-l border-zinc-200 pl-4 dark:border-zinc-700">
          <span className="font-semibold tabular-nums">{total}</span>
          <span className="text-zinc-500">total</span>
        </span>
      )}
    </div>
  );
}
