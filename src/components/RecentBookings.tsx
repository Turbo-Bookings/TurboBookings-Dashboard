"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { listRecentBookings, type RecentBookingHit } from "@/lib/actions/bookings";
import { BookingModal } from "@/components/BookingModal";
import { Badge } from "@/components/ui/Badge";
import { bookingTone } from "@/lib/ui/status";

function usd(c: number): string {
  return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Quick-view of the most-recently-created bookings, opened from a header button.
// Clicking a row opens the full BookingModal (same pattern as search).
export function RecentBookings({ slug, tz }: { slug: string; tz: string }) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<RecentBookingHit[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Fetch fresh each time the panel opens so it reflects new bookings.
  useEffect(() => {
    if (!open) return;
    let live = true;
    listRecentBookings(slug).then((r) => {
      if (live) setHits(r);
    });
    return () => {
      live = false;
    };
  }, [open, slug]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const navCls =
    "inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div ref={boxRef} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={navCls}>
        <Clock className="h-4 w-4" /> Recent
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <p className="border-b border-zinc-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            Recent bookings
          </p>
          {hits === null ? (
            <p className="px-3 py-3 text-sm text-zinc-500">Loading…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-zinc-500">No bookings yet.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(h.id);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-3 border-b border-zinc-100 px-3 py-2 text-left last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {h.customerName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        {h.itemName} · {fmt.format(h.startsAt)}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm">{usd(h.totalCents)}</span>
                    <Badge tone={bookingTone(h.status)}>{h.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {openId && <BookingModal slug={slug} bookingId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
